import { ref, computed, nextTick, onUnmounted } from 'vue'
import { useChatStore } from '../stores/chat'

export function useChatScroll(
  listEl: ReturnType<typeof ref<HTMLElement | null>>,
  uid: import('vue').ComputedRef<number>
) {
  const chatStore = useChatStore()
  const loading = ref(false)

  // --- Scroll ---
  let scrollHandler: (() => void) | null = null
  let isLoadingMore = false
  let prevMsgCount = 0
  let scrollThrottle = false

  const loadMoreOffset = ref(0)
  const loadMoreStyle = computed(() =>
    loadMoreOffset.value ? { transform: `translateY(${loadMoreOffset.value}px)` } : {}
  )

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
      listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
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
    const delta = listEl.value.scrollHeight - prevScrollHeight

    if (delta > 0) {
      loadMoreOffset.value = delta
      requestAnimationFrame(() => {
        if (listEl.value) listEl.value.scrollTop += delta
        loadMoreOffset.value = 0
        isLoadingMore = false
        loading.value = false
      })
    } else {
      isLoadingMore = false
      loading.value = false
    }
  }

  // --- Read Observer ---
  let readObserver: IntersectionObserver | null = null
  const pendingReadIds = new Set<string>()

  function setupReadObserver() {
    teardownReadObserver()
    nextTick(() => {
      if (!listEl.value) return
      readObserver = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue
            const el = entry.target as HTMLElement
            const msgId = el.dataset.msgId
            if (msgId && pendingReadIds.has(msgId)) {
              sendReadReceipt()
              return
            }
          }
        },
        { root: listEl.value, threshold: 0.1 }
      )
      observeLastUnread()
    })
  }

  function observeLastUnread() {
    if (!readObserver || !listEl.value) return
    readObserver.disconnect()
    pendingReadIds.clear()

    for (let i = chatStore.messages.length - 1; i >= 0; i--) {
      const m = chatStore.messages[i]
      if (m.senderId !== uid.value && m.isRead !== 1) {
        const id = String(m.id)
        pendingReadIds.add(id)
        const el = listEl.value.querySelector(`.msg[data-msg-id="${id}"]`)
        if (el) readObserver.observe(el)
        return
      }
    }
  }

  function sendReadReceipt() {
    if (!chatStore.currentContact) return
    chatStore.sendWsMessage({ type: 'read', data: { targetId: chatStore.currentContact.userId } })
    chatStore.currentContact.unreadCount = 0
    pendingReadIds.clear()
  }

  function teardownReadObserver() {
    if (readObserver) { readObserver.disconnect(); readObserver = null }
    pendingReadIds.clear()
  }

  function markAsReadIfVisible() {
    if (!chatStore.currentContact || !pendingReadIds.size) return
    if (isNearBottom(200)) {
      sendReadReceipt()
    }
  }

  // --- Watchers ---
  function onContactChange() {
    prevMsgCount = chatStore.messages.length
    bindScrollListener()
    setupReadObserver()
    scrollToBottom(false)
  }

  function onMessagesChange() {
    nextTick(observeLastUnread)
    markAsReadIfVisible()
    if (isLoadingMore) return
    if (chatStore.messages.length > prevMsgCount && isNearBottom()) {
      scrollToBottom(true)
    }
    prevMsgCount = chatStore.messages.length
  }

  function onListReady(el: HTMLElement | null) {
    if (el) bindScrollListener()
  }

  async function onSelectContact() {
    prevMsgCount = chatStore.messages.length
    scrollToBottom()
  }

  // --- Cleanup ---
  function cleanup() {
    removeScrollListener()
    teardownReadObserver()
  }

  onUnmounted(cleanup)

  return {
    loading,
    loadMoreStyle,
    isNearBottom,
    scrollToBottom,
    bindScrollListener,
    setupReadObserver,
    observeLastUnread,
    sendReadReceipt,
    teardownReadObserver,
    markAsReadIfVisible,
    onContactChange,
    onMessagesChange,
    onListReady,
    onSelectContact,
    cleanup,
  }
}

