import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { getMessages } from '../api'
import { useChatStore } from './chat'
import { useUserStore } from './user'
import type { Contact, Message, WsServerMessage } from '../types'

vi.mock('../api', () => ({
  getContacts: vi.fn(),
  getMessages: vi.fn(),
  uploadFile: vi.fn(),
}))

function contact(userId: number, nickname: string): Contact {
  return {
    userId,
    nickname,
    online: false,
    lastSeenAt: null,
    lastMessage: '',
    lastMessageTime: '',
    unreadCount: 0,
  }
}

function message(id: number, senderId: number, receiverId: number, content: string): Message {
  return {
    id,
    senderId,
    receiverId,
    msgType: 1,
    content,
    fileId: null,
    fileUrl: null,
    fileName: null,
    fileSize: null,
    isRead: 0,
    createdAt: `2026-09-03T10:${String(id).padStart(2, '0')}:00Z`,
  }
}

class FakeWebSocket {
  static OPEN = 1
  static instances: FakeWebSocket[] = []

  readyState = FakeWebSocket.OPEN
  onopen: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onclose: ((event: CloseEvent) => void) | null = null
  onerror: ((event: Event) => void) | null = null
  sent: string[] = []

  constructor(_url: string) {
    Object.preventExtensions(this)
    FakeWebSocket.instances.push(this)
  }

  send(value: string) {
    this.sent.push(value)
  }

  close() {
    this.readyState = 3
  }
}

describe('chat websocket observers', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.clearAllMocks()
    useUserStore().login(99, 'Me')
  })

  it('keeps an inactive cached conversation current with websocket messages', async () => {
    let resolveRefresh!: (value: any) => void
    const pendingRefresh = new Promise((resolve) => {
      resolveRefresh = resolve
    })

    vi.mocked(getMessages)
      .mockResolvedValueOnce({
        data: {
          code: 200,
          data: { messages: [message(10, 1, 99, 'Alice cached')], hasMore: false, nextCursor: '' },
        },
      } as any)
      .mockResolvedValueOnce({
        data: {
          code: 200,
          data: { messages: [message(20, 2, 99, 'Bob cached')], hasMore: false, nextCursor: '' },
        },
      } as any)
      .mockReturnValueOnce(pendingRefresh as ReturnType<typeof getMessages>)

    const store = useChatStore()
    store.contacts = [contact(1, 'Alice'), contact(2, 'Bob')]

    await store.selectContact(1)
    await store.selectContact(2)

    store.connectWs()
    const socket = FakeWebSocket.instances[0]
    const incoming: WsServerMessage = {
      type: 'chat',
      data: message(11, 1, 99, 'Alice while inactive'),
    }
    socket.onmessage?.({ data: JSON.stringify(incoming) } as MessageEvent)

    await store.selectContact(1)

    expect(store.messages.map(item => item.id)).toEqual([10, 11])
    expect(store.contacts.find(item => item.userId === 1)?.lastMessage).toBe('Alice while inactive')

    resolveRefresh({
      data: {
        code: 200,
        data: { messages: [message(10, 1, 99, 'Alice cached'), message(11, 1, 99, 'Alice while inactive')], hasMore: false, nextCursor: '' },
      },
    })
    await pendingRefresh
    await Promise.resolve()
    store.clearState()
  })

  it('notifies observers about call events without owning call state', () => {
    const store = useChatStore()
    const seen: WsServerMessage[] = []
    const unsubscribe = store.onWsMessage((message) => seen.push(message))

    store.connectWs()
    const socket = FakeWebSocket.instances[0]
    const incoming: WsServerMessage = {
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2, callType: 'video' },
    }
    socket.onmessage?.({ data: JSON.stringify(incoming) } as MessageEvent)

    expect(seen).toEqual([incoming])

    unsubscribe()
    socket.onmessage?.({ data: JSON.stringify(incoming) } as MessageEvent)
    expect(seen).toHaveLength(1)

    store.clearState()
  })
})
