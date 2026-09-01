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

describe('call store', () => {
  let rtc: {
    prepare: ReturnType<typeof vi.fn>
    startCaller: ReturnType<typeof vi.fn>
    acceptOffer: ReturnType<typeof vi.fn>
    applyAnswer: ReturnType<typeof vi.fn>
    addRemoteIce: ReturnType<typeof vi.fn>
    setMuted: ReturnType<typeof vi.fn>
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

  it('does not send call_invite when media preparation fails', async () => {
    rtc.prepare.mockRejectedValueOnce(new Error('denied'))
    const chat = useChatStore()
    const call = useCallStore()

    await call.startCall(contact())

    expect(chat.sendWsMessage).not.toHaveBeenCalled()
    expect(call.phase).toBe('failed')
  })

  it('shows preparing state immediately while microphone and ICE are pending', async () => {
    let resolvePrepare!: () => void
    rtc.prepare.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolvePrepare = resolve
    }))
    const call = useCallStore()

    const pending = call.startCall(contact())

    expect(call.phase).toBe('preparing')
    expect(call.peerName).toBe('Alice')

    resolvePrepare()
    await pending

    expect(call.phase).toBe('outgoing')
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

    call.cancelCall()
    expect(call.phase).toBe('ended')

    resolvePrepare()
    await pending

    expect(chat.sendWsMessage).not.toHaveBeenCalledWith({
      type: 'call_invite',
      data: { receiverId: 2 },
    })
  })

  it('sends call_invite only after preparation succeeds', async () => {
    const chat = useChatStore()
    const call = useCallStore()

    await call.startCall(contact())

    expect(rtc.prepare).toHaveBeenCalledTimes(1)
    expect(chat.sendWsMessage).toHaveBeenCalledWith({
      type: 'call_invite',
      data: { receiverId: 2 },
    })
    expect(call.phase).toBe('outgoing')
  })

  it('enters incoming state without requiring an open conversation', () => {
    const call = useCallStore()
    const message: WsServerMessage = {
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2 },
    }

    call.handleServerMessage(message)

    expect(call.phase).toBe('incoming')
    expect(call.callId).toBe('call-1')
    expect(call.peerName).toBe('Alice')
  })

  it('prepares media before accepting an incoming call', async () => {
    const chat = useChatStore()
    const call = useCallStore()
    call.handleServerMessage({
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2 },
    })

    await call.acceptCall()

    expect(rtc.prepare).toHaveBeenCalledTimes(1)
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
      data: { callId: 'call-1', callerId: 2 },
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
      data: { callId: 'call-1', userId: 2 },
    })
    expect(rtc.startCaller).not.toHaveBeenCalled()

    call.handleServerMessage({
      type: 'call_accepted',
      data: { callId: 'call-1' },
    })
    await Promise.resolve()

    expect(rtc.startCaller).toHaveBeenCalledTimes(1)
    expect(call.phase).toBe('connecting')
  })

  it('routes offer answer and ice into the rtc controller', async () => {
    const call = useCallStore()
    await call.startCall(contact())
    call.handleServerMessage({ type: 'call_ringing', data: { callId: 'call-1', userId: 2 } })
    call.handleServerMessage({ type: 'call_accepted', data: { callId: 'call-1' } })

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
    call.handleServerMessage({ type: 'call_ringing', data: { callId: 'call-1', userId: 2 } })
    call.handleServerMessage({ type: 'call_accepted', data: { callId: 'call-1' } })

    rtcCallbacks.onFailed('通话连接失败')

    expect(chat.sendWsMessage).toHaveBeenCalledWith({
      type: 'call_hangup',
      data: { callId: 'call-1', reason: 'failed' },
    })
    expect(call.phase).toBe('failed')
    expect(rtc.cleanup).toHaveBeenCalled()
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

  it('toggles local mute through rtc controller', () => {
    const call = useCallStore()
    call.handleServerMessage({
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2 },
    })
    call.phase = 'connecting'

    call.toggleMute()
    expect(call.muted).toBe(true)
    expect(rtc.setMuted).toHaveBeenCalledWith(true)
  })
  it('does not send invite if websocket disconnects during preparation', async () => {
    let resolvePrepare!: () => void
    rtc.prepare.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolvePrepare = resolve
    }))
    const chat = useChatStore()
    const call = useCallStore()

    const pending = call.startCall(contact())
    chat.wsStatus = 'reconnecting'
    chat.wsConnected = false
    resolvePrepare()
    await pending

    expect(chat.sendWsMessage).not.toHaveBeenCalledWith({
      type: 'call_invite',
      data: { receiverId: 2 },
    })
    expect(rtc.cleanup).toHaveBeenCalled()
    expect(call.phase).toBe('idle')
    expect(call.error).toBe('网络已断开')
  })

  it('does not resurrect an outbound call after dispose during preparation', async () => {
    let resolvePrepare!: () => void
    rtc.prepare.mockImplementationOnce(() => new Promise<void>((resolve) => {
      resolvePrepare = resolve
    }))
    const chat = useChatStore()
    const call = useCallStore()

    const pending = call.startCall(contact())
    call.dispose()
    resolvePrepare()
    await pending

    expect(chat.sendWsMessage).not.toHaveBeenCalledWith({
      type: 'call_invite',
      data: { receiverId: 2 },
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
