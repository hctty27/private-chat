import { afterEach, describe, expect, it, vi } from 'vitest'
import { useWebRtcCall, type WebRtcBrowserDeps } from './useWebRtcCall'
import type { WebRTCIceConfig } from '../types'

function createTrack(kind: 'audio' | 'video' = 'audio') {
  return {
    kind,
    enabled: true,
    stop: vi.fn(),
  } as unknown as MediaStreamTrack
}

function createStream(initialTracks: MediaStreamTrack[] = [createTrack()]) {
  const tracks = [...initialTracks]
  return {
    getAudioTracks: () => tracks.filter((track) => track.kind === 'audio'),
    getVideoTracks: () => tracks.filter((track) => track.kind === 'video'),
    getTracks: () => [...tracks],
    addTrack: (track: MediaStreamTrack) => {
      if (!tracks.includes(track)) tracks.push(track)
    },
    removeTrack: (track: MediaStreamTrack) => {
      const index = tracks.indexOf(track)
      if (index >= 0) tracks.splice(index, 1)
    },
  } as unknown as MediaStream
}

function createPeer() {
  const addedIce: RTCIceCandidateInit[] = []
  const sender = {
    track: null as MediaStreamTrack | null,
    replaceTrack: vi.fn(async (track: MediaStreamTrack | null) => {
      sender.track = track
    }),
  }
  const peer = {
    localDescription: null as RTCSessionDescriptionInit | null,
    remoteDescription: null as RTCSessionDescriptionInit | null,
    connectionState: 'new' as RTCPeerConnectionState,
    iceConnectionState: 'new' as RTCIceConnectionState,
    onicecandidate: null as RTCPeerConnection['onicecandidate'],
    ontrack: null as RTCPeerConnection['ontrack'],
    onconnectionstatechange: null as RTCPeerConnection['onconnectionstatechange'],
    oniceconnectionstatechange: null as RTCPeerConnection['oniceconnectionstatechange'],
    addTrack: vi.fn((track: MediaStreamTrack) => {
      if (track.kind === 'video') sender.track = track
      return sender as unknown as RTCRtpSender
    }),
    getSenders: vi.fn(() => sender.track ? [sender as unknown as RTCRtpSender] : []),
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
  return { peer: peer as unknown as RTCPeerConnection, raw: peer, sender, addedIce }
}

function setup(stream = createStream()) {
  const { peer, raw, sender, addedIce } = createPeer()
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
    onLocalStream: vi.fn(),
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
  return { controller, callbacks, deps, getIceConfig, stream, raw, sender, addedIce }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('useWebRtcCall', () => {
  it('prepares microphone and ice config before audio signaling', async () => {
    const { controller, deps, getIceConfig, callbacks } = setup()
    await controller.prepare('audio')
    expect(deps.getUserMedia).toHaveBeenCalledWith({ audio: true })
    expect(getIceConfig).toHaveBeenCalledTimes(1)
    expect(callbacks.onLocalStream).toHaveBeenCalledTimes(1)
  })

  it('prepares camera and microphone for video calls and adds both tracks', async () => {
    const audioTrack = createTrack('audio')
    const videoTrack = createTrack('video')
    const stream = createStream([audioTrack, videoTrack])
    const { controller, deps, raw } = setup(stream)

    await controller.prepare('video')
    await controller.startCaller()

    expect(deps.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({
      audio: true,
      video: expect.objectContaining({
        facingMode: { ideal: 'user' },
      }),
    }))
    expect(raw.addTrack).toHaveBeenCalledWith(audioTrack, stream)
    expect(raw.addTrack).toHaveBeenCalledWith(videoTrack, stream)
  })

  it('labels media preparation failures separately from ICE config failures', async () => {
    const { controller, deps } = setup()
    const mediaError = Object.assign(new Error('permission denied'), { name: 'NotAllowedError' })
    vi.mocked(deps.getUserMedia).mockRejectedValueOnce(mediaError)

    const failure = await controller.prepare('audio').catch((error) => error)

    expect(failure).toMatchObject({
      name: 'WebRtcPrepareError',
      stage: 'media',
      originalError: mediaError,
    })
  })

  it('captures synchronous media initialization errors as media failures', async () => {
    const { controller, deps } = setup()
    const mediaError = new TypeError('mediaDevices is unavailable')
    vi.mocked(deps.getUserMedia).mockImplementationOnce(() => {
      throw mediaError
    })

    const failure = await controller.prepare('audio').catch((error) => error)

    expect(failure).toMatchObject({
      stage: 'media',
      originalError: mediaError,
    })
  })

  it('stops acquired media when ice config preparation fails', async () => {
    const track = createTrack()
    const stream = createStream([track])
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
        onLocalStream: vi.fn(),
        onRemoteStream: vi.fn(),
      },
      deps,
    )

    const failure = await controller.prepare('audio').catch((error) => error)

    expect(failure).toMatchObject({
      name: 'WebRtcPrepareError',
      stage: 'ice-config',
      originalError: configError,
    })
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it('caller sets local offer then emits it', async () => {
    const { controller, callbacks, raw } = setup()
    await controller.prepare('audio')
    await controller.startCaller()
    expect(raw.setLocalDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' })
    expect(callbacks.sendOffer).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' })
  })

  it('callee sets remote offer before creating answer', async () => {
    const { controller, callbacks, raw } = setup()
    await controller.prepare('audio')
    await controller.acceptOffer({ type: 'offer', sdp: 'remote-offer' })
    expect(raw.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'remote-offer' })
    expect(raw.createAnswer).toHaveBeenCalledTimes(1)
    expect(callbacks.sendAnswer).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp' })
  })

  it('queues remote ice until remote description exists and flushes in order', async () => {
    const { controller, addedIce } = setup()
    await controller.prepare('audio')
    await controller.addRemoteIce({ candidate: 'first', sdpMid: '0' })
    await controller.addRemoteIce({ candidate: 'second', sdpMid: '0' })
    expect(addedIce).toEqual([])

    await controller.applyAnswer({ type: 'answer', sdp: 'remote-answer' })
    expect(addedIce.map((item) => item.candidate)).toEqual(['first', 'second'])
  })

  it('mutes only local audio tracks', async () => {
    const audioTrack = createTrack('audio')
    const videoTrack = createTrack('video')
    const { controller } = setup(createStream([audioTrack, videoTrack]))
    await controller.prepare('video')

    controller.setMuted(true)
    expect(audioTrack.enabled).toBe(false)
    expect(videoTrack.enabled).toBe(true)

    controller.setMuted(false)
    expect(audioTrack.enabled).toBe(true)
  })

  it('toggles only local video tracks', async () => {
    const audioTrack = createTrack('audio')
    const videoTrack = createTrack('video')
    const { controller } = setup(createStream([audioTrack, videoTrack]))
    await controller.prepare('video')

    controller.setVideoEnabled(false)
    expect(videoTrack.enabled).toBe(false)
    expect(audioTrack.enabled).toBe(true)

    controller.setVideoEnabled(true)
    expect(videoTrack.enabled).toBe(true)
  })

  it('switches camera by replacing the active video sender track', async () => {
    const audioTrack = createTrack('audio')
    const frontTrack = createTrack('video')
    const rearTrack = createTrack('video')
    const stream = createStream([audioTrack, frontTrack])
    const { controller, deps, sender, callbacks } = setup(stream)

    await controller.prepare('video')
    await controller.startCaller()
    vi.mocked(deps.getUserMedia).mockResolvedValueOnce(createStream([rearTrack]))

    await controller.switchCamera()

    expect(deps.getUserMedia).toHaveBeenLastCalledWith(expect.objectContaining({
      audio: false,
      video: expect.objectContaining({
        facingMode: { ideal: 'environment' },
      }),
    }))
    expect(sender.replaceTrack).toHaveBeenCalledWith(rearTrack)
    expect(frontTrack.stop).toHaveBeenCalledTimes(1)
    expect(stream.getVideoTracks()).toEqual([rearTrack])
    expect(callbacks.onLocalStream).toHaveBeenCalledTimes(2)
  })

  it('cleanup stops tracks and closes peer exactly once', async () => {
    const track = createTrack()
    const { controller, raw } = setup(createStream([track]))
    await controller.prepare('audio')
    await controller.startCaller()
    controller.cleanup()
    controller.cleanup()
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(raw.close).toHaveBeenCalledTimes(1)
  })

  it('waits ten seconds before failing a disconnected ice state', async () => {
    vi.useFakeTimers()
    const { controller, callbacks, raw } = setup()
    await controller.prepare('audio')
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
    await controller.prepare('audio')
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
