<template>
  <div class="chat-page">
    <!-- Sidebar (desktop only) -->
    <aside class="sidebar">
      <div class="sidebar-header">
        <h2>消息</h2>
        <div style="display:flex;align-items:center;gap:10px">
          <span class="ws-dot" :class="{ on: chatStore.wsConnected }"></span>
          <button class="logout-btn" @click="logout">退出</button>
        </div>
      </div>
      <div class="sidebar-list">
        <div
          v-for="c in chatStore.sortedContacts"
          :key="c.userId"
          class="contact-item"
          :class="{ active: chatStore.currentContact?.userId === c.userId }"
          @click="pickContact(c.userId)"
        >
          <div class="c-avatar">
            {{ c.nickname[0] }}
            <i v-if="c.online" class="c-online"></i>
          </div>
          <div class="c-info">
            <div class="c-top">
              <span class="c-name">{{ c.nickname }}</span>
              <span class="c-time" v-if="c.lastMessageTime">{{ fmtTime(c.lastMessageTime) }}</span>
            </div>
            <div class="c-bottom">
              <span class="c-msg">{{ c.lastMessage || '暂无消息' }}</span>
              <el-badge v-if="c.unreadCount > 0" :value="c.unreadCount" :max="99" />
            </div>
          </div>
        </div>
        <div v-if="chatStore.sortedContacts.length === 0" class="sidebar-empty">暂无联系人</div>
      </div>
    </aside>

    <!-- Chat area -->
    <main class="chat-main">
      <!-- Mobile: show contact list -->
      <div v-if="isMobile && !mobileChat" class="mobile-contacts">
        <div class="mobile-header">
          <h2>消息</h2>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="ws-dot" :class="{ on: chatStore.wsConnected }"></span>
            <button class="logout-btn" @click="logout">退出</button>
          </div>
        </div>
        <div class="mobile-list">
          <div
            v-for="c in chatStore.sortedContacts"
            :key="c.userId"
            class="contact-item"
            @click="openChat(c.userId)"
          >
            <div class="c-avatar">
              {{ c.nickname[0] }}
              <i v-if="c.online" class="c-online"></i>
            </div>
            <div class="c-info">
              <div class="c-top">
                <span class="c-name">{{ c.nickname }}</span>
                <span class="c-time" v-if="c.lastMessageTime">{{ fmtTime(c.lastMessageTime) }}</span>
              </div>
              <div class="c-bottom">
                <span class="c-msg">{{ c.lastMessage || '暂无消息' }}</span>
                <el-badge v-if="c.unreadCount > 0" :value="c.unreadCount" :max="99" />
              </div>
            </div>
          </div>
          <div v-if="chatStore.sortedContacts.length === 0" class="sidebar-empty">暂无联系人</div>
        </div>
      </div>

      <!-- Chat view -->
      <div v-if="!isMobile || mobileChat" class="chat-view">
        <!-- Header -->
        <div class="chat-head">
          <button v-if="isMobile" class="back" @click="mobileChat = false">
            ‹
          </button>
          <template v-if="chatStore.currentContact">
            <div class="ch-avatar">{{ chatStore.currentContact.nickname[0] }}</div>
            <div>
              <div class="ch-name">{{ chatStore.currentContact.nickname }}</div>
              <div class="ch-status">{{ chatStore.currentContact.online ? '在线' : '离线' }}</div>
            </div>
          </template>
          <span v-else class="ch-empty">选择联系人</span>
        </div>

        <!-- Messages -->
        <div ref="listEl" class="msg-scroll" @scroll="onScroll">
          <div v-if="chatStore.hasMore" class="load-more">
            <button @click="loadMore">{{ loading ? '加载中...' : '加载更多' }}</button>
          </div>

          <div v-for="(m, i) in chatStore.messages" :key="m.id">
            <div v-if="showTime(m, i)" class="time-bar">
              <span>{{ fmtChatTime(m.createdAt) }}</span>
            </div>

            <div class="msg" :class="m.senderId === uid ? 'right' : 'left'">
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
              <div v-if="m.senderId === uid && i === chatStore.messages.length - 1" class="read-tag">
                {{ m.isRead ? '已读' : '未读' }}
              </div>
            </div>
          </div>

          <div v-if="chatStore.messages.length === 0 && chatStore.currentContact" class="empty-tip">
            开始聊天吧
          </div>
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
            <button class="ibtn" :class="{ on: emojiOpen }" @click="emojiOpen = !emojiOpen">
              😊
            </button>
            <button class="ibtn" @click="fileEl?.click()">
              ＋
            </button>
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
import { formatChatTime as fmtChatTime, shouldShowTimeSeparator, formatFileSize as fmtSize, formatTime as fmtTime } from '../utils/time'
import { useRouter } from 'vue-router'

const chatStore = useChatStore()
const userStore = useUserStore()
const router = useRouter()
const uid = computed(() => userStore.userId)
const isMobile = ref(window.innerWidth < 768)
const mobileChat = ref(false)

const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const text = ref('')
const emojiOpen = ref(false)
const loading = ref(false)
const progress = ref(0)
let vvHandler: (() => void) | null = null

const emojiList = [
  '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗',
  '😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐',
  '😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲',
  '🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😱','🥵','🥶',
  '👍','👎','👏','🙌','🤝','❤️','🔥','🎉',
]

function onResize() { isMobile.value = window.innerWidth < 768 }

onMounted(async () => {
  window.addEventListener('resize', onResize)
  await chatStore.loadContacts()
  chatStore.connectWs()
})
onUnmounted(() => {
  window.removeEventListener('resize', onResize)
  chatStore.clearState()
})

async function pickContact(id: number) {
  await chatStore.selectContact(id)
  scrollTo()
}
async function openChat(id: number) {
  await chatStore.selectContact(id)
  mobileChat.value = true
  scrollTo()
}

function showTime(m: Message, i: number) {
  if (i === 0) return true
  return shouldShowTimeSeparator(m.createdAt, chatStore.messages[i - 1].createdAt)
}
function bubbleType(m: Message) {
  if (m.msgType === 4) return 'emoji'
  return m.senderId === uid.value ? 'mine' : 'his'
}

async function scrollTo(smooth = false) {
  await nextTick()
  listEl.value?.scrollTo({ top: listEl.value.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
}
function preview(url: string) { window.open(url, '_blank') }

function logout() {
  chatStore.disconnectWs()
  userStore.logout()
  chatStore.clearState()
  router.replace('/')
}
watch(() => chatStore.messages.length, () => scrollTo(true))
watch(() => chatStore.currentContact?.userId, () => scrollTo(false))

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
  await scrollTo(true)
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
    await scrollTo(true)
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
    vvHandler = () => scrollTo(false)
    window.visualViewport.addEventListener('resize', vvHandler)
  }
  setTimeout(() => scrollTo(false), 100)
  setTimeout(() => scrollTo(false), 500)
}
function onBlur() {
  if (window.visualViewport && vvHandler) {
    window.visualViewport.removeEventListener('resize', vvHandler)
    vvHandler = null
  }
}

async function onScroll() {
  if (listEl.value && listEl.value.scrollTop < 20 && chatStore.hasMore && !loading.value) {
    loading.value = true
    const h = listEl.value.scrollHeight
    await chatStore.loadMessages('loadMore')
    await nextTick()
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight - h
    loading.value = false
  }
}
async function loadMore() { await onScroll() }
</script>

<style>
/* 全局锁定 */
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
  height: 100dvh;
  overflow: hidden;
  background: #ededed;
}

/* Sidebar desktop */
.sidebar {
  width: 280px;
  flex-shrink: 0;
  background: #fff;
  border-right: 1px solid #e5e5e5;
  display: flex;
  flex-direction: column;
}
@media (max-width: 767px) {
  .sidebar { display: none; }
}
.sidebar-header {
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #f0f0f0;
}
.sidebar-header h2 {
  margin: 0; font-size: 16px; font-weight: 600;
}
.logout-btn {
  font-size: 13px; color: #999; background: none; border: 1px solid #ddd;
  border-radius: 4px; padding: 2px 8px; cursor: pointer;
  -webkit-tap-highlight-color: transparent; touch-action: manipulation;
}
.logout-btn:active { background: #f0f0f0; }
.sidebar-list { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }

/* WS dot */
.ws-dot {
  width: 8px; height: 8px; border-radius: 50%; background: #ccc; display: inline-block;
}
.ws-dot.on { background: #22c55e; }

/* Contact item */
.contact-item {
  display: flex; align-items: center; gap: 12px;
  padding: 12px 16px; cursor: pointer;
}
.contact-item:active, .contact-item.active { background: #f5f5f5; }
.c-avatar {
  width: 44px; height: 44px; border-radius: 50%;
  background: linear-gradient(135deg, #60a5fa, #a78bfa);
  display: flex; align-items: center; justify-content: center;
  color: #fff; font-weight: 600; font-size: 16px;
  flex-shrink: 0; position: relative;
}
.c-online {
  position: absolute; bottom: 0; right: 0;
  width: 10px; height: 10px; border-radius: 50%;
  background: #22c55e; border: 2px solid #fff; font-style: normal;
}
.c-info { flex: 1; min-width: 0; }
.c-top { display: flex; justify-content: space-between; align-items: center; }
.c-name { font-size: 15px; font-weight: 500; color: #111; }
.c-time { font-size: 12px; color: #999; flex-shrink: 0; }
.c-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.c-msg { font-size: 13px; color: #999; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 160px; }
.sidebar-empty { text-align: center; padding: 40px; color: #999; font-size: 14px; }

/* Chat main */
.chat-main { flex: 1; display: flex; flex-direction: column; min-width: 0; }

/* Mobile contacts */
.mobile-contacts { display: flex; flex-direction: column; height: 100%; background: #fff; }
.mobile-header {
  padding: 16px; display: flex; align-items: center; justify-content: space-between;
  border-bottom: 1px solid #f0f0f0;
  padding-top: calc(16px + env(safe-area-inset-top));
}
.mobile-header h2 { margin: 0; font-size: 17px; font-weight: 600; }
.mobile-list { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }

/* Chat view */
.chat-view { display: flex; flex-direction: column; height: 100%; overflow: hidden; }

/* Chat head */
.chat-head {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; background: #fff;
  border-bottom: 1px solid #e5e5e5; flex-shrink: 0;
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
.ch-name { font-size: 15px; font-weight: 500; color: #111; }
.ch-status { font-size: 12px; color: #999; }
.ch-empty { font-size: 14px; color: #999; }

/* Messages scroll */
.msg-scroll {
  flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 12px; background: #ededed;
}
.load-more { text-align: center; padding: 8px; }
.load-more button { font-size: 13px; color: #07c160; background: none; border: none; cursor: pointer; }

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

.read-tag { font-size: 11px; color: #b0b0b0; margin-top: 2px; padding-right: 2px; }
.empty-tip { display: flex; align-items: center; justify-content: center; height: 100%; color: #999; font-size: 14px; }

/* Emoji */
.emoji-box {
  background: #fff; border-top: 1px solid #e5e5e5; flex-shrink: 0;
  max-height: 220px;
  animation: slideUp .2s ease;
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
  -webkit-tap-highlight-color: transparent; border-radius: 6px;
  touch-action: manipulation;
}
.emoji-list button:active { background: #f0f0f0; }

/* Input */
.input-bar {
  background: #fff; border-top: 1px solid #e5e5e5; flex-shrink: 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.prog { padding: 0 16px; }
.prog-fill { height: 2px; background: #07c160; transition: width 0.2s; }
.input-row {
  display: flex; align-items: flex-end; gap: 6px;
  padding: 8px 10px;
}
.ibtn {
  width: 34px; height: 34px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  font-size: 22px; background: none; border: none;
  cursor: pointer; border-radius: 8px;
  -webkit-tap-highlight-color: transparent;
  color: #666;
}
.ibtn:active, .ibtn.on { background: #f0f0f0; }
.txt {
  flex: 1; resize: none;
  border: 1px solid #ddd; border-radius: 18px;
  padding: 7px 14px; font-size: 16px !important;
  line-height: 1.4; max-height: 100px;
  outline: none; background: #fff;
  -webkit-appearance: none; box-sizing: border-box;
}
.txt:focus { border-color: #07c160; }
.sbtn {
  height: 34px; padding: 0 14px; flex-shrink: 0;
  background: #07c160; color: #fff; border: none;
  border-radius: 17px; font-size: 14px; font-weight: 500;
  cursor: pointer; -webkit-tap-highlight-color: transparent;
}
.sbtn:disabled { background: #ccc; }
.sbtn:not(:disabled):active { background: #06ad56; }
</style>
