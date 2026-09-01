import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWebRtcCall, type WebRtcBrowserDeps } from './useWebRtcCall'
import type { WebRTCIceConfig } from '../types'

function createTrack() {
  return {
    enabled: true,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack
}

function createStream(track = createTrack()) {
  return {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream
}

function createPeer() {
  const addedIce: RTCIceCandidateInit[] = []
  const peer = {
    localDescription: null as RTCSessionDescriptionInit | null,
    remoteDescription: null as RTCSessionDescriptionInit | null,
    connectionState: 'new' as RTCPeerConnectionState,
    iceConnectionState: 'new' as RTCIceConnectionState,
    onicecandidate: null as RTCPeerConnection['onicecandidate'],
    ontrack: null as RTCPeerConnection['ontrack'],
    onconnectionstatechange: null as RTCPeerConnection['onconnectionstatechange'],
    oniceconnectionstatechange: null as RTCPeerConnection['oniceconnectionstatechange'],
    addTrack: vi.fn(),
    createOffer: vi.fn(async () => ({ type: 'offer', sdp: 'offer-sdp' } as RTCSessionDescriptionInit)),
    createAnswer: vi.fn(async () => ({ type: 'answer', sdp: 'answer-sdp' } as RTCSessionDescriptionInit)),
    setLocalDescription: vi.fn(async (description: RTCSessionDescriptionInit) => {
      peer.localDescription = description
    }),
    setRemoteDescription: vi.fn(async (description: RTCSessionDescriptionInit) => {
      peer.remoteDescription = description
    }),
    addIceCandidate: vi.fn(async (candidate: RTCIceCandidateInit) => {
      addedIce.push(candidate)
    }),
    close: vi.fn(() => {
      peer.connectionState = 'closed'
    }),
  }
  return { peer: peer as unknown as RTCPeerConnection, raw: peer, addedIce }
}

function setup() {
  const track = createTrack()
  const stream = createStream(track)
  const { peer, raw, addedIce } = createPeer()
  const iceConfig: WebRTCIceConfig = {
    iceServers: [{ urls: ['turn:turn.example.com:3478'], username: 'u', credential: 'c' }],
    iceTransportPolicy: 'all',
  }
  const callbacks = {
    sendOffer: vi.fn(),
    sendAnswer: vi.fn(),
    sendIce: vi.fn(),
    onConnected: vi.fn(),
    onFailed: vi.fn(),
    onRemoteStream: vi.fn(),
  }
  const deps: WebRtcBrowserDeps = {
    getUserMedia: vi.fn(async () => stream),
    createPeerConnection: vi.fn(() => peer),
    createMediaStream: vi.fn(() => createStream()),
    setTimeout: (callback, delay) => setTimeout(callback, delay),
    clearTimeout: (timer) => clearTimeout(timer),
  }
  const getIceConfig = vi.fn(async () => iceConfig)
  const controller = useWebRtcCall(getIceConfig, callbacks, deps)
  return { controller, callbacks, deps, getIceConfig, track, stream, raw, addedIce }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useWebRtcCall', () => {
  it('prepares microphone and ice config before signaling', async () => {
    const { controller, deps, getIceConfig } = setup()
    await controller.prepare()
    expect(deps.getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(getIceConfig).toHaveBeenCalledTimes(1)
  })

  it('labels microphone preparation failures separately from ICE config failures', async () => {
    const { controller, deps } = setup()
    const mediaError = Object.assign(new Error('permission denied'), { name: 'NotAllowedError' })
    vi.mocked(deps.getUserMedia).mockRejectedValueOnce(mediaError)

    const failure = await controller.prepare().catch((error) => error)

    expect(failure).toMatchObject({
      name: 'WebRtcPrepareError',
      stage: 'media',
      originalError: mediaError,
    })
  })

  it('captures synchronous microphone initialization errors as media failures', async () => {
    const { controller, deps } = setup()
    const mediaError = new TypeError('mediaDevices is unavailable')
    vi.mocked(deps.getUserMedia).mockImplementationOnce(() => {
      throw mediaError
    })

    const failure = await controller.prepare().catch((error) => error)

    expect(failure).toMatchObject({
      stage: 'media',
      originalError: mediaError,
    })
  })

  it('stops acquired media when ice config preparation fails', async () => {
    const track = createTrack()
    const stream = createStream(track)
    const deps: WebRtcBrowserDeps = {
      getUserMedia: vi.fn(async () => stream),
      createPeerConnection: vi.fn(),
      createMediaStream: vi.fn(),
      setTimeout: (callback, delay) => setTimeout(callback, delay),
      clearTimeout: (timer) => clearTimeout(timer),
    }
    const configError = new Error('config failed')
    const controller = useWebRtcCall(
      async () => { throw configError },
      {
        sendOffer: vi.fn(),
        sendAnswer: vi.fn(),
        sendIce: vi.fn(),
        onConnected: vi.fn(),
        onFailed: vi.fn(),
        onRemoteStream: vi.fn(),
      },
      deps,
    )

    const failure = await controller.prepare().catch((error) => error)

    expect(failure).toMatchObject({
      name: 'WebRtcPrepareError',
      stage: 'ice-config',
      originalError: configError,
    })
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('caller sets local offer then emits it', async () => {
    const { controller, callbacks, raw } = setup()
    await controller.prepare()
    await controller.startCaller()
    expect(raw.setLocalDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' })
    expect(callbacks.sendOffer).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' })
  })

  it('callee sets remote offer before creating answer', async () => {
    const { controller, callbacks, raw } = setup()
    await controller.prepare()
    await controller.acceptOffer({ type: 'offer', sdp: 'remote-offer' })
    expect(raw.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'remote-offer' })
    expect(raw.createAnswer).toHaveBeenCalledTimes(1)
    expect(callbacks.sendAnswer).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp' })
  })

  it('queues remote ice until remote description exists and flushes in order', async () => {
    const { controller, addedIce } = setup()
    await controller.prepare()
    await controller.addRemoteIce({ candidate: 'first', sdpMid: '0' })
    await controller.addRemoteIce({ candidate: 'second', sdpMid: '0' })
    expect(addedIce).toEqual([])

    await controller.applyAnswer({ type: 'answer', sdp: 'remote-answer' })
    expect(addedIce.map((item) => item.candidate)).toEqual(['first', 'second'])
  })

  it('mutes only local audio tracks', async () => {
    const { controller, track } = setup()
    await controller.prepare()
    controller.setMuted(true)
    expect(track.enabled).toBe(false)
    controller.setMuted(false)
    expect(track.enabled).toBe(true)
  })

  it('cleanup stops tracks and closes peer exactly once', async () => {
    const { controller, track, raw } = setup()
    await controller.prepare()
    await controller.startCaller()
    controller.cleanup()
    controller.cleanup()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(raw.close).toHaveBeenCalledTimes(1)
  })

  it('waits ten seconds before failing a disconnected ice state', async () => {
    vi.useFakeTimers()
    const { controller, callbacks, raw } = setup()
    await controller.prepare()
    await controller.startCaller()
    raw.iceConnectionState = 'disconnected'
    raw.oniceconnectionstatechange?.(new Event('iceconnectionstatechange'))
    expect(callbacks.onFailed).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(callbacks.onFailed).toHaveBeenCalledWith('通话连接失败')
  })

  it('cancels disconnect failure when connection recovers', async () => {
    vi.useFakeTimers()
    const { controller, callbacks, raw } = setup()
    await controller.prepare()
    await controller.startCaller()
    raw.iceConnectionState = 'disconnected'
    raw.oniceconnectionstatechange?.(new Event('iceconnectionstatechange'))
    await vi.advanceTimersByTimeAsync(5_000)
    raw.iceConnectionState = 'connected'
    raw.oniceconnectionstatechange?.(new Event('iceconnectionstatechange'))
    await vi.advanceTimersByTimeAsync(10_000)
    expect(callbacks.onFailed).not.toHaveBeenCalled()
    expect(callbacks.onConnected).toHaveBeenCalledTimes(1)
  })
})
