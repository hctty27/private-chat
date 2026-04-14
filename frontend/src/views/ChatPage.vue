<template>
  <div class="chat-page">
    <!-- Desktop sidebar -->
    <aside class="sidebar">
      <ContactList
        :contacts="chatStore.sortedContacts"
        :current-id="chatStore.currentContact?.userId ?? null"
        :ws-connected="chatStore.wsConnected"
        @select="pickContact"
        @logout="logout"
      />
    </aside>

    <!-- Main -->
    <main class="chat-main">
      <!-- Mobile: contact list -->
      <div v-if="isMobile && !mobileChat" class="mobile-contacts">
        <ContactList
          :contacts="chatStore.sortedContacts"
          :current-id="chatStore.currentContact?.userId ?? null"
          :ws-connected="chatStore.wsConnected"
          @select="openChat"
          @logout="logout"
        />
      </div>

      <!-- Chat view -->
      <div v-if="!isMobile || mobileChat" class="chat-view">
        <!-- Header -->
        <div class="chat-head">
          <button v-if="isMobile" class="back" @click="mobileChat = false">‹</button>
          <template v-if="chatStore.currentContact">
            <div class="ch-avatar">{{ chatStore.currentContact.nickname[0] }}</div>
            <div class="ch-info">
              <div class="ch-name">{{ chatStore.currentContact.nickname }}</div>
              <div class="ch-status">{{ chatStore.currentContact.online ? '在线' : '离线' }}</div>
            </div>
          </template>
          <span v-else class="ch-empty">选择联系人</span>
        </div>

        <!-- WS disconnect bar -->
        <div v-if="chatStore.currentContact && !chatStore.wsConnected" class="ws-bar">
          连接已断开，正在重连...
        </div>

        <!-- Messages -->
        <div v-if="chatStore.currentContact" ref="listEl" class="msg-scroll">
          <div ref="msgContentRef" class="msg-content" :style="loadMoreStyle">
            <!-- Load more -->
            <div class="load-more">
              <span class="spinner" v-if="loading"></span>
              <span class="load-text" v-if="loading">加载历史消息...</span>
              <span class="load-text" v-else-if="chatStore.hasMore">↑ 上拉加载更多</span>
              <span class="load-text" v-else-if="chatStore.messages.length > 0">没有更早的消息了</span>
            </div>

            <!-- Messages -->
            <div v-for="(m, i) in chatStore.messages" :key="m.id">
              <div v-if="showTime(m, i)" class="time-bar">
                <span>{{ fmtChatTime(m.createdAt) }}</span>
              </div>
              <div class="msg" :class="m.senderId === uid ? 'right' : 'left'" :data-msg-id="m.id">
                <div class="bubble" :class="bubbleType(m)">
                  <template v-if="m.msgType === 1">{{ m.content }}</template>
                  <template v-else-if="m.msgType === 4"><span class="emoji-big">{{ m.content }}</span></template>
                  <template v-else-if="m.msgType === 2 && m.fileUrl">
                    <img :src="m.fileUrl" class="pic" @click="preview(m.fileUrl!)" />
                  </template>
                  <template v-else-if="m.msgType === 3 && m.fileUrl">
                    <a :href="m.fileUrl" target="_blank" download class="file-link">
                      📎 {{ m.fileName }}
                      <small>{{ fmtSize(m.fileSize) }}</small>
                    </a>
                  </template>
                </div>
                <div v-if="m.senderId === uid" class="read-tag">
                  {{ m.isRead ? '已读' : '未读' }}
                </div>
              </div>
            </div>

            <div v-if="chatStore.messages.length === 0" class="empty-tip">开始聊天吧</div>
          </div>
        </div>

        <!-- Empty state (no contact selected) -->
        <div v-else class="empty-state">
          <div class="empty-icon">💬</div>
          <div class="empty-title">私聊</div>
          <div class="empty-desc">选择一个联系人开始聊天</div>
        </div>

        <!-- Emoji -->
        <div v-if="emojiOpen" class="emoji-box">
          <div class="emoji-head">
            <span>表情</span>
            <button @click="emojiOpen = false">✕</button>
          </div>
          <div class="emoji-list">
            <button v-for="e in emojiList" :key="e" @click="addEmoji(e)">{{ e }}</button>
          </div>
        </div>

        <!-- Input -->
        <div v-if="chatStore.currentContact" class="input-bar">
          <div v-if="progress > 0 && progress < 100" class="prog">
            <div class="prog-fill" :style="{ width: progress + '%' }"></div>
          </div>
          <div class="input-row">
            <button class="ibtn" :class="{ on: emojiOpen }" @click="emojiOpen = !emojiOpen">😊</button>
            <button class="ibtn" @click="fileEl?.click()">＋</button>
            <input ref="fileEl" type="file" hidden @change="onFile" />
            <textarea
              ref="inputEl"
              v-model="text"
              rows="1"
              class="txt"
              placeholder="输入消息..."
              @keydown.enter.exact.prevent="send"
              @input="grow"
              @focus="onFocus"
              @blur="onBlur"
            />
            <button class="sbtn" :disabled="!text.trim()" @click="send">发送</button>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useChatStore } from '../stores/chat'
import { useUserStore } from '../stores/user'
import type { Message } from '../types'
import { formatChatTime as fmtChatTime, shouldShowTimeSeparator, formatFileSize as fmtSize } from '../utils/time'
import { useRouter } from 'vue-router'
import ContactList from '../components/ContactList.vue'

const chatStore = useChatStore()
const userStore = useUserStore()
const router = useRouter()
const uid = computed(() => userStore.userId)
const isMobile = ref(window.innerWidth < 768)
const mobileChat = ref(false)

const listEl = ref<HTMLElement | null>(null)
const msgContentRef = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const text = ref('')
const emojiOpen = ref(false)
const loading = ref(false)
const progress = ref(0)

// Load more transform offset
const loadMoreOffset = ref(0)
const loadMoreStyle = computed(() =>
  loadMoreOffset.value ? { transform: `translateY(${loadMoreOffset.value}px)` } : {}
)

let isLoadingMore = false
let prevMsgCount = 0
let vvHandler: (() => void) | null = null
let scrollHandler: (() => void) | null = null
let readObserver: IntersectionObserver | null = null
// 只跟踪对方发来的未读消息 ID
const pendingReadIds = new Set<string>()

const emojiList = [
  '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗',
  '😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐',
  '😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲',
  '🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😱','🥵','🥶',
  '👍','👎','👏','🙌','🤝','❤️','🔥','🎉',
]

function onResize() { isMobile.value = window.innerWidth < 768 }

// ========== Lifecycle ==========
onMounted(async () => {
  window.addEventListener('resize', onResize)
  await chatStore.loadContacts()
  chatStore.connectWs()
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  cleanup()
  chatStore.clearState()
})

function cleanup() {
  removeScrollListener()
  teardownReadObserver()
  if (vvHandler && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', vvHandler)
  }
}

// ========== Scroll ==========
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

// ========== Read Observer ==========
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

// 只观察最后一条未读消息 — 看到它说明之前的消息也都看到了
function observeLastUnread() {
  if (!readObserver || !listEl.value) return
  // 先取消之前的观察
  readObserver.disconnect()
  pendingReadIds.clear()

  // 从后往前找最后一条对方未读消息
  for (let i = chatStore.messages.length - 1; i >= 0; i--) {
    const m = chatStore.messages[i]
    if (m.senderId !== uid.value && m.isRead !== 1) {
      const id = String(m.id)
      pendingReadIds.add(id)
      // 只查一个元素，不是全量扫描
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

// ========== Unified Watchers ==========
// Contact change → bind everything
watch(() => chatStore.currentContact?.userId, () => {
  prevMsgCount = chatStore.messages.length
  bindScrollListener()
  setupReadObserver()
  scrollToBottom(false)
})
// Mobile chat open
watch(mobileChat, (v) => { if (v) bindScrollListener() })
// Desktop first render
watch(listEl, (el) => { if (el) bindScrollListener() })
// New messages
watch(() => chatStore.messages.length, (newLen) => {
  nextTick(observeLastUnread)
  markAsReadIfVisible()
  if (isLoadingMore) return
  if (newLen > prevMsgCount && isNearBottom()) {
    scrollToBottom(true)
  }
  prevMsgCount = newLen
})

// ========== Actions ==========
async function pickContact(id: number) {
  await chatStore.selectContact(id)
  prevMsgCount = chatStore.messages.length
  scrollToBottom()
}
async function openChat(id: number) {
  await chatStore.selectContact(id)
  mobileChat.value = true
  prevMsgCount = chatStore.messages.length
  scrollToBottom()
}

function showTime(m: Message, i: number) {
  if (i === 0) return true
  return shouldShowTimeSeparator(m.createdAt, chatStore.messages[i - 1].createdAt)
}
function bubbleType(m: Message) {
  if (m.msgType === 4) return 'emoji'
  return m.senderId === uid.value ? 'mine' : 'his'
}
function preview(url: string) { window.open(url, '_blank') }
function logout() {
  chatStore.disconnectWs()
  userStore.logout()
  chatStore.clearState()
  router.replace('/')
}

function addEmoji(e: string) {
  text.value += e
  inputEl.value?.focus()
}
async function send() {
  const t = text.value.trim()
  if (!t) return
  emojiOpen.value = false
  text.value = ''
  if (inputEl.value) inputEl.value.style.height = 'auto'
  const isEmoji = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]$/u.test(t)
  chatStore.sendMessage(t, isEmoji ? 4 : 1)
  scrollToBottom(true)
}

function onFile(e: Event) {
  const inp = e.target as HTMLInputElement
  if (inp.files?.[0]) {
    if (inp.files[0].size > 50 * 1024 * 1024) { alert('最大50MB'); inp.value = ''; return }
    doUpload(inp.files[0])
  }
  inp.value = ''
}
async function doUpload(f: File) {
  progress.value = 0
  try {
    await chatStore.sendFile(f, p => { progress.value = p })
    scrollToBottom(true)
  } catch { alert('上传失败') }
  progress.value = 0
}

function grow() {
  if (!inputEl.value) return
  inputEl.value.style.height = 'auto'
  inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 100) + 'px'
}
function onFocus() {
  if (window.visualViewport) {
    vvHandler = () => scrollToBottom(false)
    window.visualViewport.addEventListener('resize', vvHandler)
  }
  setTimeout(() => scrollToBottom(false), 100)
  setTimeout(() => scrollToBottom(false), 500)
}
function onBlur() {
  if (window.visualViewport && vvHandler) {
    window.visualViewport.removeEventListener('resize', vvHandler)
    vvHandler = null
  }
}

// ========== Load more ==========
let scrollThrottle = false
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
</script>

<style>
html, body, #app {
  margin: 0; padding: 0;
  width: 100%; height: 100%;
  overflow: hidden;
  position: fixed;
  -webkit-text-size-adjust: 100%;
}
</style>

<style scoped>
.chat-page {
  display: flex;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #ededed;
}

/* Sidebar */
.sidebar {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid #e5e5e5;
}
@media (max-width: 767px) { .sidebar { display: none; } }

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.mobile-contacts {
  height: 100%;
}

/* Chat view */
.chat-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  min-height: 0;
}

.chat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
  flex-shrink: 0;
  padding-top: calc(10px + env(safe-area-inset-top));
  min-height: 52px;
}
.back {
  font-size: 28px; line-height: 1; color: #333;
  background: none; border: none; cursor: pointer;
  padding: 0 8px 0 0; font-weight: 300;
}
.ch-avatar {
  width: 34px; height: 34px; border-radius: 50%;
  background: linear-gradient(135deg, #60a5fa, #a78bfa);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 14px; flex-shrink: 0;
}
.ch-info { display: flex; flex-direction: column; }
.ch-name { font-size: 15px; font-weight: 500; color: #111; }
.ch-status { font-size: 12px; color: #999; }
.ch-empty { font-size: 14px; color: #999; }

/* WS bar */
.ws-bar {
  background: #fef3c7;
  color: #92400e;
  font-size: 13px;
  text-align: center;
  padding: 6px;
  flex-shrink: 0;
}

/* Messages */
.msg-scroll {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  padding: 12px;
  background: #ededed;
  touch-action: pan-y;
}
.load-more {
  text-align: center;
  padding: 12px 8px;
  min-height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.load-text { font-size: 12px; color: #999; }
.spinner {
  display: inline-block; width: 16px; height: 16px;
  border: 2px solid #ddd; border-top-color: #07c160;
  border-radius: 50%; animation: spin 0.6s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }

.time-bar { text-align: center; padding: 8px 0; }
.time-bar span { font-size: 12px; color: #b0b0b0; background: rgba(0,0,0,0.04); padding: 2px 10px; border-radius: 4px; }

.msg { margin-bottom: 8px; display: flex; flex-direction: column; }
.msg.right { align-items: flex-end; }
.msg.left { align-items: flex-start; }

.bubble {
  max-width: 65%; padding: 9px 13px;
  border-radius: 12px; font-size: 15px; line-height: 1.5;
  word-break: break-word;
}
.bubble.mine { background: #95ec69; color: #111; border-bottom-right-radius: 3px; }
.bubble.his { background: #fff; color: #111; border-bottom-left-radius: 3px; }
.bubble.emoji { background: transparent; padding: 2px 4px; }
.emoji-big { font-size: 52px; line-height: 1.2; }

.pic { max-width: 200px; max-height: 260px; border-radius: 8px; display: block; cursor: pointer; }
.file-link { color: #576b95; font-size: 14px; text-decoration: none; display: block; }
.file-link small { display: block; color: #999; font-size: 12px; }

.read-tag {
  font-size: 11px; color: #b0b0b0; margin-top: 2px; padding-right: 2px;
}
.empty-tip { display: flex; align-items: center; justify-content: center; height: 100%; color: #999; font-size: 14px; }

/* Empty state */
.empty-state {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: #999;
}
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.empty-title { font-size: 18px; font-weight: 600; color: #333; margin-bottom: 4px; }
.empty-desc { font-size: 14px; }

/* Emoji */
.emoji-box {
  background: #fff; border-top: 1px solid #e5e5e5; flex-shrink: 0;
  max-height: 220px; animation: slideUp .2s ease;
}
@keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.emoji-head {
  display: flex; justify-content: space-between; align-items: center;
  padding: 8px 16px; font-size: 13px; color: #666; border-bottom: 1px solid #f0f0f0;
}
.emoji-head button { background: none; border: none; color: #999; font-size: 16px; cursor: pointer; }
.emoji-list {
  display: grid; grid-template-columns: repeat(8, 1fr);
  gap: 0; padding: 8px;
  max-height: 170px; overflow-y: auto; -webkit-overflow-scrolling: touch;
}
.emoji-list button {
  width: 100%; aspect-ratio: 1; font-size: 24px;
  background: none; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  -webkit-tap-highlight-color: transparent; border-radius: 6px; touch-action: manipulation;
}
.emoji-list button:active { background: #f0f0f0; }

/* Input */
.input-bar {
  background: #fff; border-top: 1px solid #e5e5e5; flex-shrink: 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.prog { padding: 0 16px; height: 3px; }
.prog-fill { height: 100%; background: #07c160; transition: width 0.2s; }
.input-row {
  display: flex; align-items: flex-end; gap: 6px; padding: 8px 12px;
}
.ibtn {
  width: 36px; height: 36px; flex-shrink: 0;
  background: none; border: none; font-size: 20px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  -webkit-tap-highlight-color: transparent; border-radius: 6px; touch-action: manipulation;
}
.ibtn:active { background: #f0f0f0; }
.ibtn.on { background: #f0f0f0; }
.txt {
  flex: 1; border: 1px solid #ddd; border-radius: 8px;
  padding: 8px 12px; font-size: 15px; resize: none;
  outline: none; line-height: 1.4; max-height: 100px; -webkit-appearance: none;
}
.txt:focus { border-color: #07c160; }
.sbtn {
  width: 56px; height: 36px; flex-shrink: 0;
  background: #07c160; color: #fff; border: none;
  border-radius: 8px; font-size: 14px; font-weight: 500;
  cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.sbtn:disabled { background: #ccc; }
.sbtn:not(:disabled):active { background: #06ad56; }
</style>
