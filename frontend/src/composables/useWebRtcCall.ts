import type { CallType, WebRTCIceConfig } from '../types'

export interface WebRtcCallCallbacks {
  sendOffer(sdp: RTCSessionDescriptionInit): void
  sendAnswer(sdp: RTCSessionDescriptionInit): void
  sendIce(candidate: RTCIceCandidateInit): void
  onConnected(): void
  onFailed(message: string): void
  onLocalStream(stream: MediaStream): void
  onRemoteStream(stream: MediaStream): void
}

export interface WebRtcBrowserDeps {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>
  createPeerConnection(config: RTCConfiguration): RTCPeerConnection
  createMediaStream(tracks: MediaStreamTrack[]): MediaStream
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>
  clearTimeout(timer: ReturnType<typeof setTimeout>): void
}

export type WebRtcPrepareStage = 'media' | 'ice-config'

export interface WebRtcPrepareError extends Error {
  stage: WebRtcPrepareStage
  originalError: unknown
  secondaryError?: unknown
}

export interface WebRtcCallController {
  prepare(callType: CallType): Promise<void>
  startCaller(): Promise<void>
  acceptOffer(offer: RTCSessionDescriptionInit): Promise<void>
  applyAnswer(answer: RTCSessionDescriptionInit): Promise<void>
  addRemoteIce(candidate: RTCIceCandidateInit): Promise<void>
  setMuted(muted: boolean): void
  setVideoEnabled(enabled: boolean): void
  switchCamera(): Promise<void>
  cleanup(): void
}

const defaultDeps: WebRtcBrowserDeps = {
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createPeerConnection: (config) => new RTCPeerConnection(config),
  createMediaStream: (tracks) => new MediaStream(tracks),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: (timer) => clearTimeout(timer),
}

function toPrepareError(
  stage: WebRtcPrepareStage,
  originalError: unknown,
  secondaryError?: unknown,
): WebRtcPrepareError {
  const message = originalError instanceof Error
    ? originalError.message
    : stage === 'media'
      ? 'media preparation failed'
      : 'ice config preparation failed'
  const error = new Error(message) as WebRtcPrepareError
  error.name = 'WebRtcPrepareError'
  error.stage = stage
  error.originalError = originalError
  if (secondaryError !== undefined) error.secondaryError = secondaryError
  return error
}

function mediaConstraints(callType: CallType, facingMode: 'user' | 'environment'): MediaStreamConstraints {
  if (callType === 'audio') return { audio: true }
  return {
    audio: true,
    video: {
      facingMode: { ideal: facingMode },
      width: { ideal: 1280 },
      height: { ideal: 720 },
      frameRate: { ideal: 24, max: 30 },
    },
  }
}

export function useWebRtcCall(
  getIceConfig: () => Promise<WebRTCIceConfig>,
  callbacks: WebRtcCallCallbacks,
  deps: WebRtcBrowserDeps = defaultDeps,
): WebRtcCallController {
  let localStream: MediaStream | null = null
  let localCallType: CallType | null = null
  let facingMode: 'user' | 'environment' = 'user'
  let iceConfig: WebRTCIceConfig | null = null
  let peer: RTCPeerConnection | null = null
  let pendingRemoteIce: RTCIceCandidateInit[] = []
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null
  let connectedNotified = false
  let failedNotified = false

  async function prepare(callType: CallType) {
    if (localStream && iceConfig && localCallType === callType) return
    if (localStream || peer) cleanup()

    facingMode = 'user'
    const [mediaResult, configResult] = await Promise.allSettled([
      Promise.resolve().then(() => deps.getUserMedia(mediaConstraints(callType, facingMode))),
      Promise.resolve().then(() => getIceConfig()),
    ])

    if (mediaResult.status === 'rejected') {
      throw toPrepareError(
        'media',
        mediaResult.reason,
        configResult.status === 'rejected' ? configResult.reason : undefined,
      )
    }
    if (configResult.status === 'rejected') {
      for (const track of mediaResult.value.getTracks()) track.stop()
      throw toPrepareError('ice-config', configResult.reason)
    }

    localStream = mediaResult.value
    localCallType = callType
    iceConfig = configResult.value
    callbacks.onLocalStream(localStream)
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
      throw new Error('call is not prepared')
    }

    peer = deps.createPeerConnection({
      iceServers: iceConfig.iceServers,
      iceTransportPolicy: iceConfig.iceTransportPolicy,
    })

    for (const track of localStream.getTracks()) {
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

  function setVideoEnabled(enabled: boolean) {
    for (const track of localStream?.getVideoTracks() ?? []) {
      track.enabled = enabled
    }
  }

  async function switchCamera() {
    if (localCallType !== 'video' || !localStream) return

    const currentTrack = localStream.getVideoTracks()[0]
    if (!currentTrack) return

    const nextFacingMode = facingMode === 'user' ? 'environment' : 'user'
    const replacementStream = await deps.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: nextFacingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 24, max: 30 },
      },
    })
    const replacementTrack = replacementStream.getVideoTracks()[0]
    if (!replacementTrack) {
      for (const track of replacementStream.getTracks()) track.stop()
      throw new Error('camera track unavailable')
    }

    try {
      const sender = peer?.getSenders().find((item) => item.track?.kind === 'video')
      if (sender) await sender.replaceTrack(replacementTrack)

      localStream.removeTrack(currentTrack)
      currentTrack.stop()
      localStream.addTrack(replacementTrack)
      for (const track of replacementStream.getTracks()) {
        if (track !== replacementTrack) track.stop()
      }
      facingMode = nextFacingMode
      callbacks.onLocalStream(localStream)
    } catch (error) {
      replacementTrack.stop()
      throw error
    }
  }

  function cleanup() {
    clearDisconnectTimer()
    pendingRemoteIce = []
    connectedNotified = false
    failedNotified = false

    const stream = localStream
    localStream = null
    localCallType = null
    facingMode = 'user'
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
    setVideoEnabled,
    switchCamera,
    cleanup,
  }
}
