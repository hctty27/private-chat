import type { WebRTCIceConfig } from '../types'

export interface WebRtcCallCallbacks {
  sendOffer(sdp: RTCSessionDescriptionInit): void
  sendAnswer(sdp: RTCSessionDescriptionInit): void
  sendIce(candidate: RTCIceCandidateInit): void
  onConnected(): void
  onFailed(message: string): void
  onRemoteStream(stream: MediaStream): void
}

export interface WebRtcBrowserDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection
  createMediaStream(tracks: MediaStreamTrack[]): MediaStream
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

export interface WebRtcCallController {
  prepare(): Promise<void>
  startCaller(): Promise<void>
  acceptOffer(offer: RTCSessionDescriptionInit): Promise<void>
  applyAnswer(answer: RTCSessionDescriptionInit): Promise<void>
  addRemoteIce(candidate: RTCIceCandidateInit): Promise<void>
  setMuted(muted: boolean): void
  cleanup(): void
}

const defaultDeps: WebRtcBrowserDeps = {
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createPeerConnection: (config) => new RTCPeerConnection(config),
  createMediaStream: (tracks) => new MediaStream(tracks),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
}

export function useWebRtcCall(
  getIceConfig: () => Promise<WebRTCIceConfig>,
  callbacks: WebRtcCallCallbacks,
  deps: WebRtcBrowserDeps = defaultDeps,
): WebRtcCallController {
  let localStream: MediaStream | null = null
  let iceConfig: WebRTCIceConfig | null = null
  let peer: RTCPeerConnection | null = null
  let pendingRemoteIce: RTCIceCandidateInit[] = []
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null
  let connectedNotified = false
  let failedNotified = false

  async function prepare() {
    if (localStream && iceConfig) return

    const [mediaResult, configResult] = await Promise.allSettled([
      deps.getUserMedia({ audio: true }),
      getIceConfig(),
    ])

    if (mediaResult.status === 'rejected') {
      throw mediaResult.reason instanceof Error
        ? mediaResult.reason
        : new Error('voice call preparation failed')
    }
    if (configResult.status === 'rejected') {
      for (const track of mediaResult.value.getTracks()) track.stop()
      throw configResult.reason instanceof Error
        ? configResult.reason
        : new Error('voice call preparation failed')
    }

    localStream = mediaResult.value
    iceConfig = configResult.value
  }

  function clearDisconnectTimer() {
    if (disconnectTimer === null) return
    deps.clearTimeout(disconnectTimer)
    disconnectTimer = null
  }

  function notifyFailed(message: string) {
    if (failedNotified) return
    failedNotified = true
    callbacks.onFailed(message)
  }

  function handleConnectionState() {
    if (!peer) return

    const iceState = peer.iceConnectionState
    const connectionState = peer.connectionState
    if (
      connectionState === 'connected' ||
      iceState === 'connected' ||
      iceState === 'completed'
    ) {
      clearDisconnectTimer()
      if (!connectedNotified) {
        connectedNotified = true
        callbacks.onConnected()
      }
      return
    }

    if (connectionState === 'failed' || iceState === 'failed') {
      clearDisconnectTimer()
      notifyFailed('通话连接失败')
      return
    }

    if (connectionState === 'disconnected' || iceState === 'disconnected') {
      if (disconnectTimer !== null) return
      disconnectTimer = deps.setTimeout(() => {
        disconnectTimer = null
        if (!peer) return
        const recovered =
          peer.connectionState === 'connected' ||
          peer.iceConnectionState === 'connected' ||
          peer.iceConnectionState === 'completed'
        if (!recovered) notifyFailed('通话连接失败')
      }, 10_000)
    }
  }

  function ensurePeer() {
    if (peer) return peer
    if (!localStream || !iceConfig) {
      throw new Error('voice call is not prepared')
    }

    peer = deps.createPeerConnection({
      iceServers: iceConfig.iceServers,
      iceTransportPolicy: iceConfig.iceTransportPolicy,
    })

    for (const track of localStream.getAudioTracks()) {
      peer.addTrack(track, localStream)
    }

    peer.onicecandidate = (event) => {
      if (event.candidate) callbacks.sendIce(event.candidate.toJSON())
    }
    peer.ontrack = (event) => {
      const stream = event.streams[0] ?? deps.createMediaStream([event.track])
      callbacks.onRemoteStream(stream)
    }
    peer.onconnectionstatechange = handleConnectionState
    peer.oniceconnectionstatechange = handleConnectionState

    return peer
  }

  async function flushPendingRemoteIce() {
    if (!peer?.remoteDescription || pendingRemoteIce.length === 0) return
    const queued = pendingRemoteIce
    pendingRemoteIce = []
    for (const candidate of queued) {
      await peer.addIceCandidate(candidate)
    }
  }

  async function startCaller() {
    const currentPeer = ensurePeer()
    const offer = await currentPeer.createOffer()
    await currentPeer.setLocalDescription(offer)
    callbacks.sendOffer(currentPeer.localDescription ?? offer)
  }

  async function acceptOffer(offer: RTCSessionDescriptionInit) {
    const currentPeer = ensurePeer()
    await currentPeer.setRemoteDescription(offer)
    await flushPendingRemoteIce()
    const answer = await currentPeer.createAnswer()
    await currentPeer.setLocalDescription(answer)
    callbacks.sendAnswer(currentPeer.localDescription ?? answer)
  }

  async function applyAnswer(answer: RTCSessionDescriptionInit) {
    const currentPeer = ensurePeer()
    await currentPeer.setRemoteDescription(answer)
    await flushPendingRemoteIce()
  }

  async function addRemoteIce(candidate: RTCIceCandidateInit) {
    if (!peer?.remoteDescription) {
      pendingRemoteIce.push(candidate)
      return
    }
    await peer.addIceCandidate(candidate)
  }

  function setMuted(muted: boolean) {
    for (const track of localStream?.getAudioTracks() ?? []) {
      track.enabled = !muted
    }
  }

  function cleanup() {
    clearDisconnectTimer()
    pendingRemoteIce = []
    connectedNotified = false
    failedNotified = false

    const stream = localStream
    localStream = null
    iceConfig = null

    const currentPeer = peer
    peer = null

    for (const track of stream?.getTracks() ?? []) track.stop()
    if (currentPeer && currentPeer.connectionState !== 'closed') {
      currentPeer.close()
    }
  }

  return {
    prepare,
    startCaller,
    acceptOffer,
    applyAnswer,
    addRemoteIce,
    setMuted,
    cleanup,
  }
}
