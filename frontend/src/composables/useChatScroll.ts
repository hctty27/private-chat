import { ref, nextTick, onUnmounted, watch, type Ref } from 'vue'
import { useChatStore } from '../stores/chat'
import { isDocumentVisible } from '../utils/chatVisibility'

const LOAD_MORE_TRIGGER_PX = 120
const LOAD_MORE_REARM_PX = 120

export interface ConversationScrollAnchor {
  messageId: number
  offset: number
}

export function useChatScroll(
  listEl: Ref<HTMLElement | null>,
  uid: Ref<number>,
) {
  const chatStore = useChatStore()
  const loading = ref(false)
  const loadMoreError = ref('')
  const newMessageCount = ref(0)
  const showBottomButton = ref(false)

  let isLoadingMore = false
  let prevMsgCount = 0
  let loadMoreArmed = true
  let scrollHandler: (() => void) | null = null
  let wasNearBottom = true
  let messageObserver: IntersectionObserver | null = null
  let bottomSettleFrame: number | null = null
  const observedMessageItems = new Set<HTMLElement>()
  const visibleMessageIds = new Set<number>()

  function disconnectMessageObserver() {
    messageObserver?.disconnect()
    messageObserver = null
    observedMessageItems.clear()
    visibleMessageIds.clear()
  }

  function syncMessageObserver() {
    if (!listEl.value || typeof IntersectionObserver === 'undefined') return

    if (!messageObserver) {
      messageObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          const target = entry.target as HTMLElement
          const messageId = Number(target.dataset.msgId)
          if (!Number.isFinite(messageId)) continue
          if (entry.isIntersecting && entry.intersectionRatio > 0) visibleMessageIds.add(messageId)
          else visibleMessageIds.delete(messageId)
        }
        scheduleReadCheck()
      }, {
        root: listEl.value,
        threshold: 0.01,
      })
    }

    const currentItems = new Set(
      listEl.value.querySelectorAll<HTMLElement>('.message-item[data-msg-id]')
    )

    for (const item of observedMessageItems) {
      if (currentItems.has(item)) continue
      const messageId = Number(item.dataset.msgId)
      if (Number.isFinite(messageId)) visibleMessageIds.delete(messageId)
      messageObserver.unobserve(item)
      observedMessageItems.delete(item)
    }

    for (const item of currentItems) {
      if (observedMessageItems.has(item)) continue
      observedMessageItems.add(item)
      messageObserver.observe(item)
    }
  }

  function removeScrollListener() {
    if (listEl.value && scrollHandler) {
      listEl.value.removeEventListener('scroll', scrollHandler)
      scrollHandler = null
    }
    disconnectMessageObserver()
  }

  function bindScrollListener() {
    removeScrollListener()
    loadMoreArmed = true
    nextTick(() => {
      if (!listEl.value) return
      scrollHandler = onScroll
      listEl.value.addEventListener('scroll', scrollHandler, { passive: true })
      wasNearBottom = isNearBottom(80)
      syncMessageObserver()
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
    if (bottomSettleFrame !== null) {
      cancelAnimationFrame(bottomSettleFrame)
      bottomSettleFrame = null
    }

    requestAnimationFrame(() => {
      const el = listEl.value
      if (!el) return
      el.scrollTo({
        top: el.scrollHeight,
        behavior: smooth ? 'smooth' : 'auto',
      })
    })
  }

  function captureVisibleAnchor(): ConversationScrollAnchor | null {
    if (!listEl.value) return null
    const containerTop = listEl.value.getBoundingClientRect().top

    if (messageObserver && visibleMessageIds.size > 0) {
      const message = chatStore.messages.find((item) => visibleMessageIds.has(item.id))
      if (message) {
        const observedItem = listEl.value.querySelector<HTMLElement>(
          `.message-item[data-msg-id="${message.id}"]`
        )
        if (observedItem) {
          const rect = observedItem.getBoundingClientRect()
          if (rect.bottom >= containerTop) {
            return { messageId: message.id, offset: rect.top - containerTop }
          }
        }
      }
    }

    const items = listEl.value.querySelectorAll<HTMLElement>('.message-item[data-msg-id]')
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
      `.message-item[data-msg-id="${anchor.messageId}"]`
    )
    if (!item) return false

    const delta = item.getBoundingClientRect().top - listEl.value.getBoundingClientRect().top - anchor.offset
    if (delta !== 0) listEl.value.scrollTop += delta
    return true
  }

  async function restoreVisibleAnchor(anchor: ConversationScrollAnchor) {
    if (!chatStore.messages.some((message) => message.id === anchor.messageId)) return false

    await nextTick()
    const restored = restoreAnchorPosition(anchor)
    wasNearBottom = isNearBottom(80)
    return restored
  }

  async function scrollToMessage(messageId: number, smooth = true) {
    const index = chatStore.messages.findIndex((message) => message.id === messageId)
    if (index < 0 || !listEl.value) return false

    await nextTick()
    const item = listEl.value.querySelector<HTMLElement>(
      `.message-item[data-msg-id="${messageId}"]`
    )
    if (!item) return false

    item.scrollIntoView({
      block: 'center',
      behavior: smooth ? 'smooth' : 'auto',
    })
    item.classList.remove('reply-highlight')
    void item.offsetWidth
    item.classList.add('reply-highlight')
    setTimeout(() => item.classList.remove('reply-highlight'), 1400)
    wasNearBottom = isNearBottom(80)
    updateBottomButton()
    return true
  }

  async function locateMessage(messageId: number) {
    if (messageId <= 0) return false
    isLoadingMore = true
    try {
      const loaded = await chatStore.ensureMessageLoaded(messageId)
      if (!loaded) return false
      await nextTick()
      return await scrollToMessage(messageId, true)
    } finally {
      prevMsgCount = chatStore.messages.length
      isLoadingMore = false
      updateBottomButton()
    }
  }

  function onScroll() {
    if (!listEl.value) return

    const scrollTop = listEl.value.scrollTop
    if (scrollTop > LOAD_MORE_REARM_PX) loadMoreArmed = true

    wasNearBottom = isNearBottom(80)
    if (isNearBottom(160)) newMessageCount.value = 0
    updateBottomButton()
    if (!messageObserver) scheduleReadCheck()

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
    const anchor = captureVisibleAnchor()

    try {
      const loaded = await chatStore.loadMessages('loadMore')
      if (!loaded) {
        loadMoreError.value = '历史消息加载失败，点击重试'
        return
      }

      await nextTick()
      if (anchor) restoreAnchorPosition(anchor)
      syncMessageObserver()
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
    const contact = chatStore.currentContact
    if (!isDocumentVisible() || !contact || !listEl.value) return
    const isUnreadIncoming = (message: (typeof chatStore.messages)[number]) =>
      message.id > 0 && message.senderId === contact.userId &&
      message.receiverId === uid.value && message.isRead !== 1

    if (messageObserver) {
      const ids = chatStore.messages
        .filter(message => visibleMessageIds.has(message.id) && isUnreadIncoming(message))
        .map(message => message.id)
      sendReadReceipt(ids)
      return
    }

    const containerRect = listEl.value.getBoundingClientRect()
    const items = listEl.value.querySelectorAll<HTMLElement>('.message-item[data-index]')
    const ids: number[] = []
    for (const item of items) {
      const index = Number(item.dataset.index)
      if (!Number.isInteger(index)) continue
      const rect = item.getBoundingClientRect()
      if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) continue
      const message = chatStore.messages[index]
      if (message && isUnreadIncoming(message)) ids.push(message.id)
    }
    sendReadReceipt(ids)
  }

  function scheduleReadCheck() {
    if (readCheckTimer) clearTimeout(readCheckTimer)
    readCheckTimer = setTimeout(checkVisibleUnread, 300)
  }

  function sendReadReceipt(messageIds: number[]) {
    const targetId = chatStore.currentContact?.userId
    if (!targetId || !isDocumentVisible()) return
    for (let offset = 0; offset < messageIds.length; offset += 100) {
      chatStore.sendWsMessage({ type: 'read_visible', data: { targetId, messageIds: messageIds.slice(offset, offset + 100) } })
    }
  }

  // If a visible receipt was lost while disconnected, send it again after
  // reconnect. The server acknowledges matching IDs idempotently.
  watch(() => chatStore.wsConnected, connected => {
    if (connected) scheduleReadCheck()
  })

  function onVisibilityChange() {
    if (isDocumentVisible()) scheduleReadCheck()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

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
        const appended = chatStore.messages.slice(-addedCount)
        if (appended.some((message) => message.senderId !== uid.value)) {
          scrollToBottom(false)
        }
      } else {
        newMessageCount.value += addedCount
      }
    }

    prevMsgCount = currentMsgCount
    updateBottomButton()
    nextTick(() => {
      syncMessageObserver()
      scheduleReadCheck()
    })
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
    if (bottomSettleFrame !== null) cancelAnimationFrame(bottomSettleFrame)
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
    isNearBottom,
    scrollToBottom,
    scrollToBottomAndClear,
    bindScrollListener,
    retryLoadMore,
    captureVisibleAnchor,
    restoreVisibleAnchor,
    scrollToMessage,
    locateMessage,
    sendReadReceipt,
    onContactChange,
    onMessagesChange,
    onListReady,
    onSelectContact,
    cleanup,
  }
}
