import { ref, computed, nextTick, onUnmounted, watch, type ComponentPublicInstance, type Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useChatStore } from '../stores/chat'
import { isDocumentVisible } from '../utils/chatVisibility'

export interface ConversationScrollAnchor {
  messageId: number
  offset: number
}

export function useChatScroll(
  listEl: Ref<HTMLElement | null>,
  uid: Ref<number>
) {
  const chatStore = useChatStore()
  const loading = ref(false)
  const loadMoreError = ref('')
  const newMessageCount = ref(0)
  const showBottomButton = ref(false)
  const estimatedMessageHeight = 72

  const virtualizer = useVirtualizer(computed(() => ({
    count: chatStore.messages.length,
    getScrollElement: () => listEl.value,
    estimateSize: () => estimatedMessageHeight,
    getItemKey: (index: number) => chatStore.messages[index]?.id ?? index,
    overscan: 10,
  })))

  let isLoadingMore = false
  let prevMsgCount = 0
  let scrollThrottle = false
  let scrollHandler: (() => void) | null = null

  function removeScrollListener() {
    if (listEl.value && scrollHandler) {
      listEl.value.removeEventListener('scroll', scrollHandler)
      scrollHandler = null
    }
  }

  function bindScrollListener() {
    removeScrollListener()
    nextTick(() => {
      if (listEl.value) {
        scrollHandler = onScroll
        listEl.value.addEventListener('scroll', scrollHandler, { passive: true })
      }
    })
  }

  function isNearBottom(threshold = 100) {
    if (!listEl.value) return true
    const { scrollTop, scrollHeight, clientHeight } = listEl.value
    return scrollHeight - scrollTop - clientHeight < threshold
  }

  function updateBottomButton() {
    showBottomButton.value = newMessageCount.value > 0 || (!!listEl.value && !isNearBottom(160))
  }

  function scrollToBottomAndClear(smooth = true) {
    newMessageCount.value = 0
    showBottomButton.value = false
    scrollToBottom(smooth)
  }

  function scrollToBottom(smooth = false) {
    requestAnimationFrame(() => {
      if (!listEl.value) return
      listEl.value.scrollTo({
        top: listEl.value.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      })
    })
  }

  function nextFrame() {
    return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }

  function captureVisibleAnchor(): ConversationScrollAnchor | null {
    if (!listEl.value) return null
    const containerTop = listEl.value.getBoundingClientRect().top
    const items = listEl.value.querySelectorAll<HTMLElement>('.virtual-item[data-msg-id]')

    for (const item of items) {
      const messageId = Number(item.dataset.msgId)
      if (!Number.isFinite(messageId)) continue
      const rect = item.getBoundingClientRect()
      if (rect.bottom >= containerTop) {
        return { messageId, offset: rect.top - containerTop }
      }
    }

    return null
  }

  function restoreAnchorPosition(anchor: ConversationScrollAnchor) {
    if (!listEl.value) return false
    const item = listEl.value.querySelector<HTMLElement>(`.virtual-item[data-msg-id="${anchor.messageId}"]`)
    if (!item) return false

    const delta = item.getBoundingClientRect().top - listEl.value.getBoundingClientRect().top - anchor.offset
    if (delta !== 0) listEl.value.scrollTop += delta
    return true
  }

  async function restoreVisibleAnchor(anchor: ConversationScrollAnchor) {
    const index = chatStore.messages.findIndex((m) => m.id === anchor.messageId)
    if (index < 0) return false

    virtualizer.value.scrollToIndex(index, { align: 'start', behavior: 'auto' })
    await nextFrame()
    await nextTick()
    const restored = restoreAnchorPosition(anchor)
    await nextFrame()
    restoreAnchorPosition(anchor)
    return restored
  }

  function measureItem(el: Element | ComponentPublicInstance | null) {
    if (el instanceof Element) virtualizer.value.measureElement(el)
  }

  function onScroll() {
    if (!listEl.value) return

    if (isNearBottom(160)) newMessageCount.value = 0
    updateBottomButton()

    if (loading.value || !chatStore.hasMore || scrollThrottle) return
    if (listEl.value.scrollTop < 60) {
      scrollThrottle = true
      void loadMore()
      setTimeout(() => { scrollThrottle = false }, 300)
    }
  }

  async function loadMore() {
    if (!listEl.value || loading.value || !chatStore.hasMore) return
    loading.value = true
    loadMoreError.value = ''
    isLoadingMore = true
    const anchor = captureVisibleAnchor()
    const prevScrollHeight = listEl.value.scrollHeight
    const prevMsgCount = chatStore.messages.length

    try {
      const loaded = await chatStore.loadMessages('loadMore')
      if (!loaded) {
        loadMoreError.value = '历史消息加载失败，点击重试'
        return
      }

      await nextTick()
      if (!listEl.value) return

      const prependedCount = chatStore.messages.length - prevMsgCount
      if (anchor && prependedCount > 0) {
        listEl.value.scrollTop += prependedCount * estimatedMessageHeight
      }

      const restored = anchor ? await restoreVisibleAnchor(anchor) : false
      if (!restored) {
        const delta = listEl.value.scrollHeight - prevScrollHeight
        if (delta > 0) listEl.value.scrollTop += delta
      }
    } finally {
      isLoadingMore = false
      loading.value = false
    }
  }

  async function retryLoadMore() {
    if (loading.value) return
    await loadMore()
  }

  let readCheckTimer: ReturnType<typeof setTimeout> | null = null

  function checkVisibleUnread() {
    if (!isDocumentVisible() || !chatStore.currentContact || !listEl.value) return
    const v = virtualizer.value
    const items = v.getVirtualItems()
    if (!items.length) return

    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      const msg = chatStore.messages[item.index]
      if (msg && msg.senderId !== uid.value && msg.isRead !== 1) {
        sendReadReceipt()
        return
      }
    }
  }

  function scheduleReadCheck() {
    if (readCheckTimer) clearTimeout(readCheckTimer)
    readCheckTimer = setTimeout(checkVisibleUnread, 300)
  }

  function sendReadReceipt() {
    if (!chatStore.currentContact || !isDocumentVisible()) return
    chatStore.sendWsMessage({ type: 'read', data: { targetId: chatStore.currentContact.userId } })
    chatStore.currentContact.unreadCount = 0
  }

  function onVisibilityChange() {
    if (isDocumentVisible()) scheduleReadCheck()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  watch(
    () => virtualizer.value.getVirtualItems(),
    () => { scheduleReadCheck() },
    { flush: 'post' }
  )

  function onContactChange(options: { scrollToBottom?: boolean } = {}) {
    prevMsgCount = chatStore.messages.length
    newMessageCount.value = 0
    showBottomButton.value = false
    bindScrollListener()
    if (options.scrollToBottom !== false) scrollToBottom(false)
  }

  function onMessagesChange() {
    const currentMsgCount = chatStore.messages.length
    const addedCount = currentMsgCount - prevMsgCount

    if (!isLoadingMore && addedCount > 0) {
      if (isNearBottom()) {
        newMessageCount.value = 0
        scrollToBottom(true)
      } else {
        newMessageCount.value += addedCount
      }
    }

    prevMsgCount = currentMsgCount
    updateBottomButton()
  }

  function onListReady(el: HTMLElement | null) {
    if (el) bindScrollListener()
  }

  function onSelectContact() {
    prevMsgCount = chatStore.messages.length
    scrollToBottomAndClear(false)
  }

  function cleanup() {
    removeScrollListener()
    if (readCheckTimer) clearTimeout(readCheckTimer)
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }

  onUnmounted(cleanup)

  return {
    loading,
    loadMoreError,
    newMessageCount,
    showBottomButton,
    virtualizer,
    isNearBottom,
    scrollToBottom,
    scrollToBottomAndClear,
    measureItem,
    bindScrollListener,
    retryLoadMore,
    captureVisibleAnchor,
    restoreVisibleAnchor,
    sendReadReceipt,
    onContactChange,
    onMessagesChange,
    onListReady,
    onSelectContact,
    cleanup,
  }
}
