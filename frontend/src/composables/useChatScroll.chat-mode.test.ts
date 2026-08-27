import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick, onMounted, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '../stores/chat'
import { useChatScroll } from './useChatScroll'

const virtualizerMock = vi.hoisted(() => ({
  options: null as unknown,
  scrollToEnd: vi.fn(),
  scrollToIndex: vi.fn(),
}))

vi.mock('@tanstack/vue-virtual', async () => {
  const { ref } = await import('vue')
  return {
    useVirtualizer: (options: unknown) => {
      virtualizerMock.options = options
      return ref({
        getVirtualItems: () => [],
        measureElement: vi.fn(),
        scrollToEnd: virtualizerMock.scrollToEnd,
        scrollToIndex: virtualizerMock.scrollToIndex,
      })
    },
  }
})

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

function mountScrollHarness(virtualized = true) {
  let scroll!: ReturnType<typeof useChatScroll>

  const Harness = defineComponent({
    setup() {
      const listEl = ref<HTMLElement | null>(null)
      scroll = useChatScroll(listEl, ref(99), { virtualized })
      onMounted(() => scroll.onListReady(listEl.value))
      return { listEl }
    },
    template: '<div ref="listEl"></div>',
  })

  const wrapper = mount(Harness, { attachTo: document.body })
  return { wrapper, getScroll: () => scroll }
}

describe('useChatScroll chat mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    virtualizerMock.options = null
    virtualizerMock.scrollToEnd.mockReset()
    virtualizerMock.scrollToIndex.mockReset()
  })

  it('configures end anchoring and accounts for the history status row', async () => {
    const chatStore = useChatStore()
    chatStore.messages = [createMessage(1)]
    const { wrapper } = mountScrollHarness()
    await nextTick()

    const optionsRef = virtualizerMock.options as { value: Record<string, unknown> }
    expect(optionsRef.value).toMatchObject({
      anchorTo: 'end',
      followOnAppend: true,
      scrollEndThreshold: 80,
      overscan: 6,
      scrollMargin: 44,
    })

    wrapper.unmount()
  })

  it('uses the virtualizer end command instead of writing the DOM scroll position', async () => {
    const chatStore = useChatStore()
    chatStore.messages = [createMessage(1)]
    const { wrapper, getScroll } = mountScrollHarness()
    await nextTick()

    const container = wrapper.element as HTMLElement
    const scrollTo = vi.fn()
    Object.defineProperty(container, 'scrollTo', { configurable: true, value: scrollTo })

    getScroll().scrollToBottom(false)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

    expect(virtualizerMock.scrollToEnd).toHaveBeenCalledWith({ behavior: 'auto' })
    expect(scrollTo).not.toHaveBeenCalled()

    wrapper.unmount()
  })

  it('does not manually change scrollTop when older messages are prepended', async () => {
    const chatStore = useChatStore()
    chatStore.hasMore = true
    chatStore.messages = [createMessage(1), createMessage(2)]
    vi.spyOn(chatStore, 'loadMessages').mockImplementation(async () => {
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
    container.getBoundingClientRect = () => ({
      top: 0,
      bottom: 400,
      left: 0,
      right: 320,
      width: 320,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const item = document.createElement('div')
    item.className = 'virtual-item'
    item.dataset.msgId = '1'
    item.getBoundingClientRect = () => ({
      top: 10,
      bottom: 82,
      left: 0,
      right: 320,
      width: 320,
      height: 72,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    })
    container.appendChild(item)

    container.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(chatStore.loadMessages).toHaveBeenCalledWith('loadMore'))
    await nextTick()

    expect(container.scrollTop).toBe(20)

    wrapper.unmount()
  })

  it('preserves the visible message when native mobile history is prepended', async () => {
    const chatStore = useChatStore()
    chatStore.hasMore = true
    chatStore.messages = [createMessage(1), createMessage(2)]

    let prepended = false
    vi.spyOn(chatStore, 'loadMessages').mockImplementation(async () => {
      prepended = true
      chatStore.messages = [createMessage(0), ...chatStore.messages]
      return true
    })

    const { wrapper } = mountScrollHarness(false)
    await nextTick()
    await nextTick()

    const optionsRef = virtualizerMock.options as { value: Record<string, unknown> }
    expect(optionsRef.value.enabled).toBe(false)

    const container = wrapper.element as HTMLElement
    Object.defineProperty(container, 'scrollHeight', { configurable: true, value: 1000 })
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 400 })
    container.scrollTop = 20
    container.getBoundingClientRect = () => ({
      top: 0,
      bottom: 400,
      left: 0,
      right: 320,
      width: 320,
      height: 400,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })

    const item = document.createElement('div')
    item.className = 'message-item'
    item.dataset.index = '0'
    item.dataset.msgId = '1'
    item.getBoundingClientRect = () => ({
      top: prepended ? 82 : 10,
      bottom: prepended ? 154 : 82,
      left: 0,
      right: 320,
      width: 320,
      height: 72,
      x: 0,
      y: prepended ? 82 : 10,
      toJSON: () => ({}),
    })
    container.appendChild(item)

    container.dispatchEvent(new Event('scroll'))
    await vi.waitFor(() => expect(chatStore.loadMessages).toHaveBeenCalledWith('loadMore'))
    await nextTick()

    expect(container.scrollTop).toBe(92)

    wrapper.unmount()
  })

  it('loads history ahead of the top edge only once until the viewport leaves the top zone', async () => {
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

      await vi.advanceTimersByTimeAsync(301)
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
