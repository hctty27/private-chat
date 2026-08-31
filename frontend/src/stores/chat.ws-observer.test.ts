import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useChatStore } from './chat'
import { useUserStore } from './user'
import type { WsServerMessage } from '../types'

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
    useUserStore().login(99, 'Me')
  })

  it('notifies observers about call events without owning call state', () => {
    const store = useChatStore()
    const seen: WsServerMessage[] = []
    const unsubscribe = store.onWsMessage((message) => seen.push(message))

    store.connectWs()
    const socket = FakeWebSocket.instances[0]
    const incoming: WsServerMessage = {
      type: 'call_incoming',
      data: { callId: 'call-1', callerId: 2 },
    }
    socket.onmessage?.({ data: JSON.stringify(incoming) } as MessageEvent)

    expect(seen).toEqual([incoming])

    unsubscribe()
    socket.onmessage?.({ data: JSON.stringify(incoming) } as MessageEvent)
    expect(seen).toHaveLength(1)

    store.clearState()
  })
})
