import { ref, computed, nextTick, onUnmounted, watch, type ComponentPublicInstance, type Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useChatStore } from '../stores/chat'
import { isDocumentVisible } from '../utils/chatVisibility'

export const CHAT_SCROLL_MARGIN = 44
const LOAD_MORE_TRIGGER_PX = 120
const LOAD_MORE_REARM_PX = 120

export interface ConversationScrollAnchor {
  messageId: number
  offset: number
}

export interface ChatScrollOptions {
  virtualized?: boolean
}

export function useChatScroll(
  listEl: Ref<HTMLElement | null>,
  uid: Ref<number>,
  options: ChatScrollOptions = {}
) {
  const chatStore = useChatStore()
  const virtualized = options.virtualized !== false
  const loading = ref(false)
  const loadMoreError = ref('')
  const newMessageCount = ref(0)
  const showBottomButton = ref(false)
  const estimatedMessageHeight = 72

  const virtualizer = useVirtualizer(computed(() => ({
    count: chatStore.messages.length,
    getScrollElement: () => listEl.value,
    enabled: virtualized,
    estimateSize: () => estimatedMessageHeight,
    getItemKey: (index: number) => chatStore.messages[index]?.id ?? index,
    anchorTo: 'end' as const,
    followOnAppend: true,
    scrollEndThreshold: 80,
    scrollMargin: CHAT_SCROLL_MARGIN,
    overscan: 6,
  })))

  let isLoadingMore = false
  let prevMsgCount = 0
  let loadMoreArmed = true
  let scrollHandler: (() => void) | null = null
  let wasNearBottom = true

  function removeScrollListener() {
    if (listEl.value && scrollHandler) {
      listEl.value.removeEventListener('scroll', scrollHandler)
      scrollHandler = null
    }
  }

  function bindScrollListener() {
    removeScrollListener()
    loadMoreArmed = true
    nextTick(() => {
      if (listEl.value) {
        scrollHandler = onScroll
        listEl.value.addEventListener('scroll', scrollHandler, { passive: true })
        wasNearBottom = isNearBottom(80)
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
    wasNearBottom = true
    requestAnimationFrame(() => {
      if (virtualized) {
        virtualizer.value.scrollToEnd({ behavior: smooth ? 'smooth' : 'auto' })
        return
      }

      const el = listEl.value
      if (!el) return
      el.scrollTo({
        top: el.scrollHeight,
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
    const items = listEl.value.querySelectorAll<HTMLElement>('.virtual-item[data-msg-id], .message-item[data-msg-id]')

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
    const item = listEl.value.querySelector<HTMLElement>(
      `.virtual-item[data-msg-id="${anchor.messageId}"], .message-item[data-msg-id="${anchor.messageId}"]`
    )
    if (!item) return false

    const delta = item.getBoundingClientRect().top - listEl.value.getBoundingClientRect().top - anchor.offset
    if (delta !== 0) listEl.value.scrollTop += delta
    return true
  }

  async function restoreVisibleAnchor(anchor: ConversationScrollAnchor) {
    const index = chatStore.messages.findIndex((m) => m.id === anchor.messageId)
    if (index < 0) return false

    if (!virtualized) {
      await nextTick()
      const restored = restoreAnchorPosition(anchor)
      wasNearBottom = isNearBottom(80)
      return restored
    }

    virtualizer.value.scrollToIndex(index, { align: 'start', behavior: 'auto' })
    await nextFrame()
    await nextTick()
    const restored = restoreAnchorPosition(anchor)
    await nextFrame()
    restoreAnchorPosition(anchor)
    wasNearBottom = isNearBottom(80)
    return restored
  }

  function measureItem(el: Element | ComponentPublicInstance | null) {
    if (el instanceof Element) virtualizer.value.measureElement(el)
  }

  function onScroll() {
    if (!listEl.value) return

    const scrollTop = listEl.value.scrollTop
    if (scrollTop > LOAD_MORE_REARM_PX) loadMoreArmed = true

    wasNearBottom = isNearBottom(80)
    if (isNearBottom(160)) newMessageCount.value = 0
    updateBottomButton()

    if (loading.value || !chatStore.hasMore || !loadMoreArmed) return
    if (scrollTop <= LOAD_MORE_TRIGGER_PX) {
      loadMoreArmed = false
      void loadMore()
    }
  }

  async function loadMore() {
    if (!listEl.value || loading.value || !chatStore.hasMore) return
    loading.value = true
    loadMoreError.value = ''
    isLoadingMore = true
    const anchor = virtualized ? null : captureVisibleAnchor()

    try {
      const loaded = await chatStore.loadMessages('loadMore')
      if (!loaded) {
        loadMoreError.value = '历史消息加载失败，点击重试'
        return
      }

      await nextTick()
      if (anchor) restoreAnchorPosition(anchor)
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

    if (!virtualized) {
      const containerRect = listEl.value.getBoundingClientRect()
      const items = Array.from(
        listEl.value.querySelectorAll<HTMLElement>('.message-item[data-index]')
      )

      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i]
        const index = Number(item.dataset.index)
        if (!Number.isInteger(index)) continue

        const rect = item.getBoundingClientRect()
        if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) continue

        const msg = chatStore.messages[index]
        if (msg && msg.senderId !== uid.value && msg.isRead !== 1) {
          sendReadReceipt()
          return
        }
      }
      return
    }

    const items = virtualizer.value.getVirtualItems()
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
      if (wasNearBottom) {
        newMessageCount.value = 0
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
