import { ref, computed, nextTick, onUnmounted, watch, type ComponentPublicInstance, type Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useChatStore } from '../stores/chat'

export function useChatScroll(
  listEl: Ref<HTMLElement | null>,
  uid: Ref<number>
) {
  const chatStore = useChatStore()
  const loading = ref(false)
  const estimatedMessageHeight = 72

  // --- Virtualizer (传 computed 实现响应式) ---
  const virtualizer = useVirtualizer(computed(() => ({
    count: chatStore.messages.length,
    getScrollElement: () => listEl.value,
    estimateSize: () => estimatedMessageHeight,
    getItemKey: (index: number) => chatStore.messages[index]?.id ?? index,
    overscan: 10,
  })))

  // --- Scroll ---
  type ScrollAnchor = {
    messageId: number
    offset: number
  }

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

  function captureScrollAnchor(): ScrollAnchor | null {
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

  function restoreScrollAnchor(anchor: ScrollAnchor) {
    if (!listEl.value) return false
    const item = listEl.value.querySelector<HTMLElement>(`.virtual-item[data-msg-id="${anchor.messageId}"]`)
    if (!item) return false

    const delta = item.getBoundingClientRect().top - listEl.value.getBoundingClientRect().top - anchor.offset
    if (delta !== 0) listEl.value.scrollTop += delta
    return true
  }

  async function restoreLoadedAnchor(anchor: ScrollAnchor | null) {
    if (!anchor) return false
    if (!chatStore.messages.some((m) => m.id === anchor.messageId)) return false

    await nextFrame()
    await nextTick()
    const restored = restoreScrollAnchor(anchor)
    await nextFrame()
    restoreScrollAnchor(anchor)
    return restored
  }

  function measureItem(el: Element | ComponentPublicInstance | null) {
    if (el instanceof Element) virtualizer.value.measureElement(el)
  }

  function onScroll() {
    if (!listEl.value || loading.value || !chatStore.hasMore || scrollThrottle) return
    if (listEl.value.scrollTop < 60) {
      scrollThrottle = true
      loadMore()
      setTimeout(() => { scrollThrottle = false }, 300)
    }
  }

  async function loadMore() {
    if (!listEl.value || loading.value || !chatStore.hasMore) return
    loading.value = true
    isLoadingMore = true
    const anchor = captureScrollAnchor()
    const prevScrollHeight = listEl.value.scrollHeight
    const prevMsgCount = chatStore.messages.length

    await chatStore.loadMessages('loadMore')
    await nextTick()

    if (!listEl.value) { loading.value = false; isLoadingMore = false; return }

    const prependedCount = chatStore.messages.length - prevMsgCount
    if (anchor && prependedCount > 0) {
      listEl.value.scrollTop += prependedCount * estimatedMessageHeight
    }

    if (!(await restoreLoadedAnchor(anchor))) {
      const delta = listEl.value.scrollHeight - prevScrollHeight
      if (delta > 0) listEl.value.scrollTop += delta
    }

    isLoadingMore = false
    loading.value = false
  }

  // --- Read Observer ---
  let readCheckTimer: ReturnType<typeof setTimeout> | null = null

  function checkVisibleUnread() {
    if (!chatStore.currentContact || !listEl.value) return
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
    if (!chatStore.currentContact) return
    chatStore.sendWsMessage({ type: 'read', data: { targetId: chatStore.currentContact.userId } })
    chatStore.currentContact.unreadCount = 0
  }

  watch(
    () => virtualizer.value.getVirtualItems(),
    () => { scheduleReadCheck() },
    { flush: 'post' }
  )

  // --- Watchers ---
  function onContactChange() {
    prevMsgCount = chatStore.messages.length
    bindScrollListener()
    scrollToBottom(false)
  }

  function onMessagesChange() {
    if (isLoadingMore) return
    if (chatStore.messages.length > prevMsgCount && isNearBottom()) {
      scrollToBottom(true)
    }
    prevMsgCount = chatStore.messages.length
  }

  function onListReady(el: HTMLElement | null) {
    if (el) bindScrollListener()
  }

  function onSelectContact() {
    prevMsgCount = chatStore.messages.length
    scrollToBottom()
  }

  // --- Cleanup ---
  function cleanup() {
    removeScrollListener()
    if (readCheckTimer) clearTimeout(readCheckTimer)
  }

  onUnmounted(cleanup)

  return {
    loading,
    virtualizer,
    isNearBottom,
    scrollToBottom,
    measureItem,
    bindScrollListener,
    sendReadReceipt,
    onContactChange,
    onMessagesChange,
    onListReady,
    onSelectContact,
    cleanup,
  }
}
