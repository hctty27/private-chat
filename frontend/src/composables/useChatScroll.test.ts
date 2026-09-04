import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick, onMounted, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../stores/chat'
import { useChatScroll } from './useChatScroll'

function createMessage(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    senderId: 1,
    receiverId: 99,
    msgType: 1 as const,
    content: `message-${id}`,
    fileId: null,
    fileUrl: null,
    fileName: null,
    fileSize: null,
    isRead: 1 as const,
    createdAt: '2026-08-14T08:00:00Z',
    ...overrides,
  }
}

function mountScrollHarness() {
  let scroll!: ReturnType<typeof useChatScroll>

  const Harness = defineComponent({
    setup() {
      const listEl = ref<HTMLElement | null>(null)
      scroll = useChatScroll(listEl, ref(99))
      onMounted(() => scroll.onListReady(listEl.value))
      return { listEl }
    },
    template: '<div ref="listEl"></div>',
  })

  const wrapper = mount(Harness, { attachTo: document.body })
  return { wrapper, getScroll: () => scroll }
}

async function settleScrollBinding() {
  await nextTick()
  await nextTick()
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    value,
  })
}

function rect(top: number, bottom: number) {
  return {
    top,
    bottom,
    left: 0,
    right: 300,
    width: 300,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

describe('useChatScroll load-more feedback', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('exposes a load-more error without moving the current scroll position', async () => {
    const chatStore = useChatStore()
    chatStore.hasMore = true
    chatStore.messages = [createMessage(1)]
    vi.spyOn(chatStore, 'loadMessages').mockResolvedValue(false)

    const { wrapper, getScroll } = mountScrollHarness()
    await settleScrollBinding()
    const container = wrapper.element as HTMLElement
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 400 })
    container.scrollTop = 20
    const beforeScrollTop = container.scrollTop

    container.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(chatStore.loadMessages).toHaveBeenCalledWith('loadMore'))
    await nextTick()

    expect(getScroll().loadMoreError.value).toBe('历史消息加载失败，点击重试')
    expect(container.scrollTop).toBe(beforeScrollTop)

    wrapper.unmount()
  })

  it('clears the load-more error after a successful retry', async () => {
    const chatStore = useChatStore()
    chatStore.hasMore = true
    chatStore.messages = [createMessage(1)]
    const load = vi.spyOn(chatStore, 'loadMessages')
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)

    const { wrapper, getScroll } = mountScrollHarness()
    await settleScrollBinding()
    const container = wrapper.element as HTMLElement
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 400 })
    container.scrollTop = 20

    container.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    await nextTick()
    expect(getScroll().loadMoreError.value).toBe('历史消息加载失败，点击重试')

    await getScroll().retryLoadMore()

    expect(load).toHaveBeenCalledTimes(2)
    expect(getScroll().loadMoreError.value).toBe('')

    wrapper.unmount()
  })
})

describe('useChatScroll public anchor API', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('captures the first visible message anchor', async () => {
    const chatStore = useChatStore()
    chatStore.messages = [createMessage(10)]

    const { wrapper, getScroll } = mountScrollHarness()
    await settleScrollBinding()
    const container = wrapper.element as HTMLElement
    container.getBoundingClientRect = () => rect(100, 500) as DOMRect

    const item = document.createElement('div')
    item.className = 'message-item'
    item.dataset.msgId = '10'
    item.getBoundingClientRect = () => rect(112, 184) as DOMRect
    container.appendChild(item)

    expect(getScroll().captureVisibleAnchor()).toEqual({ messageId: 10, offset: 12 })

    wrapper.unmount()
  })

  it('returns false when the remembered anchor message is not loaded', async () => {
    const chatStore = useChatStore()
    chatStore.messages = [createMessage(10)]
    const { wrapper, getScroll } = mountScrollHarness()
    await settleScrollBinding()

    await expect(getScroll().restoreVisibleAnchor({ messageId: 99, offset: 0 })).resolves.toBe(false)

    wrapper.unmount()
  })

  it('restores a loaded native message anchor', async () => {
    const chatStore = useChatStore()
    chatStore.messages = [createMessage(10), createMessage(20), createMessage(30)]
    const { wrapper, getScroll } = mountScrollHarness()
    await settleScrollBinding()
    const container = wrapper.element as HTMLElement
    container.scrollTop = 100
    container.getBoundingClientRect = () => rect(100, 500) as DOMRect

    const item = document.createElement('div')
    item.className = 'message-item'
    item.dataset.msgId = '20'
    item.getBoundingClientRect = () => {
      const top = 200 - container.scrollTop
      return rect(top, top + 72) as DOMRect
    }
    container.appendChild(item)

    await expect(getScroll().restoreVisibleAnchor({ messageId: 20, offset: -12 })).resolves.toBe(true)
    expect(container.scrollTop).toBe(112)

    wrapper.unmount()
  })
})

describe('useChatScroll visibility-aware read receipts', () => {
  const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState')

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility)
  })

  it('tracks native message visibility with IntersectionObserver', async () => {
    const chatStore = useChatStore()
    chatStore.currentContact = {
      userId: 2,
      nickname: 'Bob',
      online: true,
      lastSeenAt: null,
      lastMessage: '',
      lastMessageTime: '',
      unreadCount: 1,
    }
    chatStore.messages = [createMessage(1, {
      senderId: 2,
      receiverId: 99,
      isRead: 0,
    })]
    const send = vi.spyOn(chatStore, 'sendWsMessage')

    let observerCallback: IntersectionObserverCallback | null = null
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback
      }
      observe = observe
      unobserve = vi.fn()
      disconnect = disconnect
    })

    setVisibility('visible')
    const { wrapper, getScroll } = mountScrollHarness()
    await settleScrollBinding()

    const item = document.createElement('div')
    item.className = 'message-item'
    item.dataset.msgId = '1'
    wrapper.element.appendChild(item)

    getScroll().bindScrollListener()
    await settleScrollBinding()
    expect(observe).toHaveBeenCalledWith(item)

    observerCallback?.([
      {
        target: item,
        isIntersecting: true,
        intersectionRatio: 1,
      } as IntersectionObserverEntry,
    ], {} as IntersectionObserver)
    await vi.advanceTimersByTimeAsync(350)

    expect(send).toHaveBeenCalledWith({ type: 'read', data: { targetId: 2 } })
    expect(chatStore.currentContact.unreadCount).toBe(0)

    wrapper.unmount()
    expect(disconnect).toHaveBeenCalled()
  })

  it('does not send while hidden and retries when the document becomes visible', async () => {
    const chatStore = useChatStore()
    chatStore.currentContact = {
      userId: 2,
      nickname: 'Bob',
      online: true,
      lastSeenAt: null,
      lastMessage: '',
      lastMessageTime: '',
      unreadCount: 1,
    }
    chatStore.messages = [createMessage(1, {
      senderId: 2,
      receiverId: 99,
      isRead: 0,
    })]
    const send = vi.spyOn(chatStore, 'sendWsMessage')
    vi.stubGlobal('IntersectionObserver', undefined)

    setVisibility('hidden')
    const { wrapper } = mountScrollHarness()
    await settleScrollBinding()
    const container = wrapper.element as HTMLElement
    container.getBoundingClientRect = () => rect(0, 400) as DOMRect

    const item = document.createElement('div')
    item.className = 'message-item'
    item.dataset.index = '0'
    item.dataset.msgId = '1'
    item.getBoundingClientRect = () => rect(20, 92) as DOMRect
    container.appendChild(item)

    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(350)
    expect(send).not.toHaveBeenCalled()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(350)

    expect(send).toHaveBeenCalledWith({ type: 'read', data: { targetId: 2 } })
    expect(chatStore.currentContact.unreadCount).toBe(0)

    wrapper.unmount()
  })
})
