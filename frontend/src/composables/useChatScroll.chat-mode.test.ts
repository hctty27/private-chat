import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick, onMounted, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../stores/chat'
import { useChatScroll } from './useChatScroll'

function createMessage(id: number) {
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
    createdAt: '2026-08-25T08:00:00Z',
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

function rect(top: number, bottom: number) {
  return {
    top,
    bottom,
    left: 0,
    right: 320,
    width: 320,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  }
}

describe('useChatScroll native chat mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('scrolls to the native DOM end', async () => {
    const chatStore = useChatStore()
    chatStore.messages = [createMessage(1)]
    const { wrapper, getScroll } = mountScrollHarness()
    await nextTick()

    const container = wrapper.element as HTMLElement
    const scrollTo = vi.fn()
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo })
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1200 })

    getScroll().scrollToBottom(false)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    expect(scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: 'auto' })
    wrapper.unmount()
  })

  it('preserves the visible message when older history is prepended', async () => {
    const chatStore = useChatStore()
    chatStore.hasMore = true
    chatStore.messages = [createMessage(1), createMessage(2)]

    let prepended = false
    vi.spyOn(chatStore, 'loadMessages').mockImplementation(async () => {
      prepended = true
      chatStore.messages = [createMessage(0), ...chatStore.messages]
      return true
    })

    const { wrapper } = mountScrollHarness()
    await nextTick()
    await nextTick()

    const container = wrapper.element as HTMLElement
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 400 })
    container.scrollTop = 20
    container.getBoundingClientRect = () => rect(0, 400) as DOMRect

    const item = document.createElement('div')
    item.className = 'message-item'
    item.dataset.index = '0'
    item.dataset.msgId = '1'
    item.getBoundingClientRect = () => rect(prepended ? 82 : 10, prepended ? 154 : 82) as DOMRect
    container.appendChild(item)

    container.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(chatStore.loadMessages).toHaveBeenCalledWith('loadMore'))
    await nextTick()

    expect(container.scrollTop).toBe(92)
    wrapper.unmount()
  })

  it('loads history only once until the viewport leaves the top trigger zone', async () => {
    vi.useFakeTimers()
    const chatStore = useChatStore()
    chatStore.hasMore = true
    chatStore.messages = [createMessage(1), createMessage(2)]

    let resolveLoad!: (value: boolean) => void
    const pendingLoad = new Promise<boolean>((resolve) => {
      resolveLoad = resolve
    })
    const loadMessages = vi.spyOn(chatStore, 'loadMessages').mockImplementation(() => pendingLoad)

    const { wrapper, getScroll } = mountScrollHarness()

    try {
      await nextTick()
      await nextTick()

      const container = wrapper.element as HTMLElement
      Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 })
      Object.defineProperty(container, 'clientHeight', { configurable: true, value: 400 })

      container.scrollTop = 100
      container.dispatchEvent(new Event('scroll'))
      await Promise.resolve()
      expect(loadMessages).toHaveBeenCalledTimes(1)
      expect(getScroll().loading.value).toBe(true)

      resolveLoad(true)
      await Promise.resolve()
      await nextTick()
      await Promise.resolve()
      expect(getScroll().loading.value).toBe(false)

      container.dispatchEvent(new Event('scroll'))
      await Promise.resolve()
      expect(loadMessages).toHaveBeenCalledTimes(1)

      container.scrollTop = 160
      container.dispatchEvent(new Event('scroll'))
      container.scrollTop = 100
      container.dispatchEvent(new Event('scroll'))
      await Promise.resolve()
      expect(loadMessages).toHaveBeenCalledTimes(2)
    } finally {
      wrapper.unmount()
      vi.useRealTimers()
    }
  })
})
