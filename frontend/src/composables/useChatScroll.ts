import { ref, computed, nextTick, onUnmounted, watch, type Ref } from 'vue'
import { useVirtualizer } from '@tanstack/vue-virtual'
import { useChatStore } from '../stores/chat'

export function useChatScroll(
  listEl: Ref<HTMLElement | null>,
  uid: Ref<number>
) {
  const chatStore = useChatStore()
  const loading = ref(false)

  // --- loadMore 补偿偏移 ---
  const loadMoreOffset = ref(0)
  const loadMoreStyle = computed(() =>
    loadMoreOffset.value ? { transform: `translateY(${loadMoreOffset.value}px)` } : {}
  )

  // --- Virtualizer ---
  const virtualizer = useVirtualizer(computed(() => ({
    count: chatStore.messages.length,
    getScrollElement: () => listEl.value,
    estimateSize: () => 72,
    overscan: 10,
  })))

  // --- Scroll ---
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
    const prevScrollHeight = listEl.value.scrollHeight

    await chatStore.loadMessages('loadMore')
    await nextTick()

    if (!listEl.value) { loading.value = false; isLoadingMore = false; return }

    // 等虚拟滚动测量完实际高度后再补偿
    await nextTick()

    if (!listEl.value) { loading.value = false; isLoadingMore = false; return }
    const delta = listEl.value.scrollHeight - prevScrollHeight

    if (delta > 0) {
      // 先用 transform 瞬间补偿，防止视觉跳动
      loadMoreOffset.value = delta
      requestAnimationFrame(() => {
        if (listEl.value) listEl.value.scrollTop += delta
        // 下一帧移除 transform
        requestAnimationFrame(() => {
          loadMoreOffset.value = 0
          isLoadingMore = false
          loading.value = false
        })
      })
    } else {
      isLoadingMore = false
      loading.value = false
    }
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
    loadMoreOffset.value = 0
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
    loadMoreStyle,
    isNearBottom,
    scrollToBottom,
    bindScrollListener,
    sendReadReceipt,
    onContactChange,
    onMessagesChange,
    onListReady,
    onSelectContact,
    cleanup,
  }
}
