import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { Contact, WsServerMessage } from '../types'
import { useChatStore } from './chat'
import { useUserStore } from './user'
import { useCallStore } from './call'
import { useWebRtcCall } from '../composables/useWebRtcCall'
import { getWebRTCIceConfig } from '../api'

vi.mock('../api', () => ({
  getContacts: vi.fn(),
  getMessages: vi.fn(),
  uploadFile: vi.fn(),
  getWebRTCIceConfig: vi.fn(),
  getWebRTCStatus: vi.fn(),
}))

vi.mock('../composables/useWebRtcCall', () => ({
  useWebRtcCall: vi.fn(),
}))

function contact(userId = 2, nickname = 'Alice'): Contact {
  return {
    userId,
    nickname,
    online: true,
    lastSeenAt: null,
    lastMessage: '',
    lastMessageTime: '',
    unreadCount: 0,
  }
}

function prepareError(stage: 'media' | 'ice-config', originalError: unknown) {
  const message = originalError instanceof Error ? originalError.message : 'prepare failed'
  return Object.assign(new Error(message), {
    name: 'WebRtcPrepareError',
    stage,
    originalError,
  })
}

describe('call store', () => {
  let rtc: {
    prepare: ReturnType<typeof vi.fn>
    startCaller: ReturnType<typeof vi.fn>
    acceptOffer: ReturnType<typeof vi.fn>
    applyAnswer: ReturnType<typeof vi.fn>
    addRemoteIce: ReturnType<typeof vi.fn>
    setMuted: ReturnType<typeof vi.fn>
    setVideoEnabled: ReturnType<typeof vi.fn>
    switchCamera: ReturnType<typeof vi.fn>
    cleanup: ReturnType<typeof vi.fn>
  }
  let rtcCallbacks: any

  beforeEach(() => {
    vi.useRealTimers()
    localStorage.clear()
    setActivePinia(createPinia())
    useUserStore().login(99, 'Me')

    rtc = {
      prepare: vi.fn(async () => undefined),
      startCaller: vi.fn(async () => undefined),
      acceptOffer: vi.fn(async () => undefined),
      applyAnswer: vi.fn(async () => undefined),
      addRemoteIce: vi.fn(async () => undefined),
      setMuted: vi.fn(),
      setVideoEnabled: vi.fn(),
      switchCamera: vi.fn(async () => undefined),
      cleanup: vi.fn(),
    }
    vi.mocked(useWebRtcCall).mockImplementation((_getConfig, callbacks) => {
      rtcCallbacks = callbacks
      return rtc
    })
    vi.mocked(getWebRTCIceConfig).mockResolvedValue({
      data: { code: 200, data: { iceServers: [], iceTransportPolicy: 'all' } },
    } as any)

    const chat = useChatStore()
    chat.wsConnected = true
    chat.wsStatus = 'connected'
    chat.contacts = [contact()]
    vi.spyOn(chat, 'sendWsMessage').mockImplementation(() => undefined)
    useCallStore().available = true
  })

  it('does not initialize the WebRTC runtime while idle or only ringing', () => {
    const call = useCallStore()

    expect(useWebRtcCall).not.toHaveBeenCalled()

    call.ensureBound()
    call.handleServerMessage({
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2, callType: 'audio' },
    })

    expect(call.phase).toBe('incoming')
    expect(useWebRtcCall).not.toHaveBeenCalled()
  })

  it('initializes the WebRTC runtime when the user accepts a call', async () => {
    const call = useCallStore()
    call.handleServerMessage({
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2, callType: 'audio' },
    })

    await call.acceptCall()

    expect(useWebRtcCall).toHaveBeenCalledTimes(1)
    expect(rtc.prepare).toHaveBeenCalledWith('audio')
    expect(call.phase).toBe('connecting')
  })

  it('does not silently ignore a user-initiated call when availability probe is false', async () => {
    const call = useCallStore()
    call.available = false

    await call.startCall(contact())

    expect(rtc.prepare).toHaveBeenCalledWith('audio')
    expect(call.phase).toBe('outgoing')
  })

  it('starts video calls with camera media and video signaling', async () => {
    const chat = useChatStore()
    const call = useCallStore()

    await call.startCall(contact(), 'video')

    expect(call.callType).toBe('video')
    expect(rtc.prepare).toHaveBeenCalledWith('video')
    expect(chat.sendWsMessage).toHaveBeenCalledWith({
      type: 'call_invite',
      data: { receiverId: 2, callType: 'video' },
    })
  })

  it('does not send call_invite when media preparation fails', async () => {
    rtc.prepare.mockRejectedValueOnce(new Error('denied'))
    const chat = useChatStore()
    const call = useCallStore()

    await call.startCall(contact())

    expect(chat.sendWsMessage).not.toHaveBeenCalled()
    expect(call.phase).toBe('failed')
  })

  it('shows iOS Safari recovery guidance for AVAudioSession capture failures', async () => {
    const originalError = Object.assign(
      new Error('No AVAudioSessionCaptureDevice device'),
      { name: 'NotAllowedError' },
    )
    rtc.prepare.mockRejectedValueOnce(prepareError('media', originalError))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const call = useCallStore()

    await call.startCall(contact())

    expect(call.phase).toBe('failed')
    expect(call.error).toBe('iOS 麦克风服务异常，请完全关闭 Safari 后重新打开')
    expect(consoleError).toHaveBeenCalledWith(
      '[voice-call] preparation failed',
      expect.objectContaining({
        direction: 'outgoing',
        callType: 'audio',
        stage: 'media',
        name: 'NotAllowedError',
        message: 'No AVAudioSessionCaptureDevice device',
      }),
    )
    consoleError.mockRestore()
  })

  it('shows microphone permission guidance for NotAllowedError', async () => {
    const originalError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    rtc.prepare.mockRejectedValueOnce(prepareError('media', originalError))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const call = useCallStore()

    await call.startCall(contact())

    expect(call.error).toBe('无法使用麦克风，请检查浏览器权限')
    consoleError.mockRestore()
  })

  it('shows missing microphone guidance for NotFoundError', async () => {
    const originalError = Object.assign(new Error('device not found'), { name: 'NotFoundError' })
    rtc.prepare.mockRejectedValueOnce(prepareError('media', originalError))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const call = useCallStore()

    await call.startCall(contact())

    expect(call.error).toBe('未检测到可用麦克风')
    consoleError.mockRestore()
  })

  it('shows microphone device troubleshooting guidance for NotReadableError', async () => {
    const originalError = Object.assign(new Error('audio source unavailable'), { name: 'NotReadableError' })
    rtc.prepare.mockRejectedValueOnce(prepareError('media', originalError))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const call = useCallStore()

    await call.startCall(contact())

    expect(call.error).toBe('麦克风暂时不可用，请检查设备或关闭占用麦克风的应用')
    consoleError.mockRestore()
  })

  it('shows camera and microphone guidance for video permission failures', async () => {
    const originalError = Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })
    rtc.prepare.mockRejectedValueOnce(prepareError('media', originalError))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const call = useCallStore()

    await call.startCall(contact(), 'video')

    expect(call.error).toBe('无法使用摄像头或麦克风，请检查浏览器权限')
    consoleError.mockRestore()
  })

  it('distinguishes ICE config service failures from microphone failures', async () => {
    const originalError = Object.assign(new Error('service unavailable'), {
      response: { status: 503 },
    })
    rtc.prepare.mockRejectedValueOnce(prepareError('ice-config', originalError))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const call = useCallStore()

    await call.startCall(contact())

    expect(call.phase).toBe('failed')
    expect(call.error).toBe('通话服务暂不可用')
    expect(consoleError).toHaveBeenCalledWith(
      '[voice-call] preparation failed',
      expect.objectContaining({
        stage: 'ice-config',
        httpStatus: 503,
      }),
    )
    consoleError.mockRestore()
  })

  it('shows preparing state immediately while media and ICE are pending', async () => {
    let resolvePrepare!: () => void
    rtc.prepare.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolvePrepare = resolve
    }))
    const call = useCallStore()

    const pending = call.startCall(contact())

    expect(call.phase).toBe('preparing')
    expect(call.peerName).toBe('Alice')
    await vi.waitFor(() => expect(rtc.prepare).toHaveBeenCalledTimes(1))

    resolvePrepare()
    await pending

    expect(call.phase).toBe('outgoing')
  })

  it('does not start media preparation when cancelled during lazy runtime loading', async () => {
    const chat = useChatStore()
    const call = useCallStore()

    const pending = call.startCall(contact())
    expect(call.phase).toBe('preparing')

    call.cancelCall()
    await pending

    expect(rtc.prepare).not.toHaveBeenCalled()
    expect(chat.sendWsMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'call_invite' }),
    )
    expect(call.phase).toBe('ended')
  })

  it('cancels preparation without sending any call signal', async () => {
    let resolvePrepare!: () => void
    rtc.prepare.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolvePrepare = resolve
    }))
    const chat = useChatStore()
    const call = useCallStore()

    const pending = call.startCall(contact())
    expect(call.phase).toBe('preparing')
    await vi.waitFor(() => expect(rtc.prepare).toHaveBeenCalledTimes(1))

    call.cancelCall()
    expect(call.phase).toBe('ended')

    resolvePrepare()
    await pending

    expect(chat.sendWsMessage).not.toHaveBeenCalledWith({
      type: 'call_invite',
      data: { receiverId: 2, callType: 'audio' },
    })
  })

  it('sends call_invite only after preparation succeeds', async () => {
    const chat = useChatStore()
    const call = useCallStore()

    await call.startCall(contact())

    expect(rtc.prepare).toHaveBeenCalledWith('audio')
    expect(chat.sendWsMessage).toHaveBeenCalledWith({
      type: 'call_invite',
      data: { receiverId: 2, callType: 'audio' },
    })
    expect(call.phase).toBe('outgoing')
  })

  it('enters incoming state without requiring an open conversation', () => {
    const call = useCallStore()
    const message: WsServerMessage = {
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2, callType: 'audio' },
    }

    call.handleServerMessage(message)

    expect(call.phase).toBe('incoming')
    expect(call.callId).toBe('call-1')
    expect(call.callType).toBe('audio')
    expect(call.peerName).toBe('Alice')
  })

  it('prepares video media before accepting an incoming video call', async () => {
    const chat = useChatStore()
    const call = useCallStore()
    call.handleServerMessage({
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2, callType: 'video' },
    })

    await call.acceptCall()

    expect(call.callType).toBe('video')
    expect(rtc.prepare).toHaveBeenCalledWith('video')
    expect(chat.sendWsMessage).toHaveBeenCalledWith({
      type: 'call_accept',
      data: { callId: 'call-1' },
    })
    expect(call.phase).toBe('connecting')
  })

  it('rejects with media_unavailable when callee preparation fails', async () => {
    rtc.prepare.mockRejectedValueOnce(new Error('denied'))
    const chat = useChatStore()
    const call = useCallStore()
    call.handleServerMessage({
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2, callType: 'audio' },
    })

    await call.acceptCall()

    expect(chat.sendWsMessage).toHaveBeenCalledWith({
      type: 'call_reject',
      data: { callId: 'call-1', reason: 'media_unavailable' },
    })
    expect(call.phase).toBe('failed')
  })

  it('starts the caller offer only after call_accepted', async () => {
    const call = useCallStore()
    await call.startCall(contact())
    call.handleServerMessage({
      type: 'call_ringing',
      data: { callId: 'call-1', userId: 2, callType: 'audio' },
    })
    expect(rtc.startCaller).not.toHaveBeenCalled()

    call.handleServerMessage({
      type: 'call_accepted',
      data: { callId: 'call-1', callType: 'audio' },
    })
    await Promise.resolve()

    expect(rtc.startCaller).toHaveBeenCalledTimes(1)
    expect(call.phase).toBe('connecting')
  })

  it('routes offer answer and ice into the rtc controller', async () => {
    const call = useCallStore()
    await call.startCall(contact())
    call.handleServerMessage({
      type: 'call_ringing',
      data: { callId: 'call-1', userId: 2, callType: 'audio' },
    })
    call.handleServerMessage({
      type: 'call_accepted',
      data: { callId: 'call-1', callType: 'audio' },
    })

    call.handleServerMessage({
      type: 'webrtc_offer',
      data: { callId: 'call-1', sdp: { type: 'offer', sdp: 'x' } },
    })
    call.handleServerMessage({
      type: 'webrtc_answer',
      data: { callId: 'call-1', sdp: { type: 'answer', sdp: 'y' } },
    })
    call.handleServerMessage({
      type: 'webrtc_ice',
      data: { callId: 'call-1', candidate: { candidate: 'c', sdpMid: '0' } },
    })
    await Promise.resolve()

    expect(rtc.acceptOffer).toHaveBeenCalled()
    expect(rtc.applyAnswer).toHaveBeenCalled()
    expect(rtc.addRemoteIce).toHaveBeenCalled()
  })

  it('sends failed hangup when rtc reports unrecoverable failure', async () => {
    const chat = useChatStore()
    const call = useCallStore()
    await call.startCall(contact())
    call.handleServerMessage({
      type: 'call_ringing',
      data: { callId: 'call-1', userId: 2, callType: 'audio' },
    })
    call.handleServerMessage({
      type: 'call_accepted',
      data: { callId: 'call-1', callType: 'audio' },
    })

    rtcCallbacks.onFailed('通话连接失败')

    expect(chat.sendWsMessage).toHaveBeenCalledWith({
      type: 'call_hangup',
      data: { callId: 'call-1', reason: 'failed' },
    })
    expect(call.phase).toBe('failed')
    expect(rtc.cleanup).toHaveBeenCalled()
  })

  it('keeps local and remote streams in store callbacks', async () => {
    const call = useCallStore()
    const local = {} as MediaStream
    const remote = {} as MediaStream

    await call.startCall(contact())
    rtcCallbacks.onLocalStream(local)
    rtcCallbacks.onRemoteStream(remote)

    expect(call.localStream).toBe(local)
    expect(call.remoteStream).toBe(remote)
  })

  it('cleans local media immediately when kicked', async () => {
    const call = useCallStore()
    await call.startCall(contact())

    call.handleServerMessage({
      type: 'kicked',
      data: { message: '账号已在其他设备登录' },
    })

    expect(rtc.cleanup).toHaveBeenCalled()
    expect(call.phase).toBe('failed')
  })

  it('toggles local mute through rtc controller', async () => {
    const call = useCallStore()
    call.handleServerMessage({
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2, callType: 'audio' },
    })
    await call.acceptCall()

    call.toggleMute()
    expect(call.muted).toBe(true)
    expect(rtc.setMuted).toHaveBeenCalledWith(true)
  })

  it('toggles the local camera only for video calls', async () => {
    const call = useCallStore()
    call.handleServerMessage({
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2, callType: 'video' },
    })
    await call.acceptCall()

    call.toggleCamera()
    expect(call.cameraOff).toBe(true)
    expect(rtc.setVideoEnabled).toHaveBeenCalledWith(false)

    call.toggleCamera()
    expect(call.cameraOff).toBe(false)
    expect(rtc.setVideoEnabled).toHaveBeenCalledWith(true)
  })

  it('switches camera through the rtc controller for video calls', async () => {
    const call = useCallStore()
    call.handleServerMessage({
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2, callType: 'video' },
    })
    await call.acceptCall()
    call.phase = 'connected'

    await call.switchCamera()

    expect(rtc.switchCamera).toHaveBeenCalledTimes(1)
  })

  it('does not send invite if websocket disconnects during preparation', async () => {
    let resolvePrepare!: () => void
    rtc.prepare.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolvePrepare = resolve
    }))
    const chat = useChatStore()
    const call = useCallStore()

    const pending = call.startCall(contact())
    await vi.waitFor(() => expect(rtc.prepare).toHaveBeenCalledTimes(1))
    chat.wsStatus = 'reconnecting'
    chat.wsConnected = false
    await nextTick()

    expect(call.phase).toBe('failed')
    expect(call.error).toBe('网络已断开')

    resolvePrepare()
    await pending

    expect(chat.sendWsMessage).not.toHaveBeenCalledWith({
      type: 'call_invite',
      data: { receiverId: 2, callType: 'audio' },
    })
    expect(rtc.cleanup).toHaveBeenCalled()
    expect(call.phase).toBe('failed')
  })

  it('does not resurrect an outbound call after dispose during preparation', async () => {
    let resolvePrepare!: () => void
    rtc.prepare.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolvePrepare = resolve
    }))
    const chat = useChatStore()
    const call = useCallStore()

    const pending = call.startCall(contact())
    await vi.waitFor(() => expect(rtc.prepare).toHaveBeenCalledTimes(1))
    call.dispose()
    resolvePrepare()
    await pending

    expect(chat.sendWsMessage).not.toHaveBeenCalledWith({
      type: 'call_invite',
      data: { receiverId: 2, callType: 'audio' },
    })
    expect(rtc.cleanup).toHaveBeenCalled()
    expect(call.phase).toBe('idle')
  })

  it('does not end a call during websocket heartbeat probing', async () => {
    const chat = useChatStore()
    const call = useCallStore()
    await call.startCall(contact())

    chat.wsConnected = false
    await nextTick()

    expect(call.phase).toBe('outgoing')

    chat.wsStatus = 'reconnecting'
    await nextTick()

    expect(call.phase).toBe('failed')
  })
})
