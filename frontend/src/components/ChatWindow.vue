<template>
  <div ref="containerRef" class="chat-container">
    <!-- Chat header -->
    <div class="chat-header">
      <button
        v-if="showBack"
        class="back-btn"
        @click="$emit('back')"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div v-if="chatStore.currentContact" class="header-info">
        <div class="avatar-wrapper">
          <div class="avatar">{{ chatStore.currentContact.nickname[0] }}</div>
          <div v-if="chatStore.currentContact.online" class="online-dot"></div>
        </div>
        <div>
          <div class="name">{{ chatStore.currentContact.nickname }}</div>
          <div class="status">{{ chatStore.currentContact.online ? '在线' : '离线' }}</div>
        </div>
      </div>
      <div v-else class="no-contact">选择一个联系人开始聊天</div>
    </div>

    <!-- Messages area -->
    <div
      v-if="chatStore.currentContact"
      ref="msgListRef"
      class="msg-list"
      @scroll="onScroll"
    >
      <div v-if="chatStore.hasMore" class="load-more">
        <button :disabled="loadingMore" @click="loadMore">
          {{ loadingMore ? '加载中...' : '加载更多' }}
        </button>
      </div>

      <template v-for="(msg, index) in chatStore.messages" :key="msg.id">
        <div v-if="shouldShowTime(msg, index)" class="time-sep">
          <span>{{ formatChatTime(msg.createdAt) }}</span>
        </div>

        <div class="msg-row" :class="isMine(msg) ? 'mine' : 'theirs'">
          <div class="msg-bubble" :class="getBubbleClass(msg)">
            <template v-if="msg.msgType === 1">{{ msg.content }}</template>
            <template v-else-if="msg.msgType === 4"><span class="big-emoji">{{ msg.content }}</span></template>
            <template v-else-if="msg.msgType === 2 && msg.fileUrl">
              <img :src="msg.fileUrl" class="msg-img" @click="previewImage(msg.fileUrl!)" />
            </template>
            <template v-else-if="msg.msgType === 3 && msg.fileUrl">
              <a :href="msg.fileUrl" target="_blank" download class="msg-file">
                <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
                <div class="min-w-0">
                  <div class="file-name">{{ msg.fileName }}</div>
                  <div class="file-size">{{ formatFileSize(msg.fileSize) }}</div>
                </div>
              </a>
            </template>
          </div>
          <div v-if="isMine(msg) && index === chatStore.messages.length - 1" class="read-status">
            {{ msg.isRead ? '已读' : '未读' }}
          </div>
        </div>
      </template>

      <div v-if="chatStore.messages.length === 0" class="empty-msg">发送第一条消息吧</div>
    </div>

    <div v-else class="msg-list empty-msg">选择一个联系人开始聊天</div>

    <!-- Emoji panel -->
    <transition name="slide-up">
      <div v-if="showEmoji" class="emoji-panel">
        <div class="emoji-header">
          <span>表情</span>
          <button class="emoji-close" @click="showEmoji = false">✕</button>
        </div>
        <div class="emoji-grid">
          <button v-for="e in emojis" :key="e" class="emoji-btn" @click="insertEmoji(e)">{{ e }}</button>
        </div>
      </div>
    </transition>

    <!-- Toolbar area -->
    <div v-if="chatStore.currentContact" class="toolbar" :class="{ 'emoji-open': showEmoji }">
      <!-- Upload progress -->
      <div v-if="uploadProgress > 0 && uploadProgress < 100" class="upload-bar">
        <div class="upload-track">
          <div class="upload-fill" :style="{ width: uploadProgress + '%' }"></div>
        </div>
        <span class="upload-pct">{{ uploadProgress }}%</span>
      </div>

      <div class="toolbar-row">
        <!-- Toggle emoji -->
        <button class="tool-btn" :class="{ active: showEmoji }" @click="toggleEmoji">
          <span class="tool-icon">😊</span>
        </button>

        <!-- File upload -->
        <button class="tool-btn" @click="fileInputRef?.click()">
          <svg class="tool-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <input ref="fileInputRef" type="file" class="hidden" @change="onFileSelect" />

        <!-- Text input -->
        <div class="input-wrap">
          <textarea
            ref="inputRef"
            v-model="inputText"
            rows="1"
            class="chat-input"
            placeholder="输入消息..."
            @keydown.enter.exact.prevent="sendText"
            @input="autoResize"
            @focus="onFocus"
            @blur="onBlur"
          />
        </div>

        <!-- Send -->
        <button
          class="send-btn"
          :class="{ disabled: !canSend }"
          :disabled="!canSend"
          @click="sendText"
        >
          发送
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed, onMounted, onUnmounted } from 'vue'
import { useChatStore } from '../stores/chat'
import { useUserStore } from '../stores/user'
import type { Message } from '../types'
import { formatChatTime, shouldShowTimeSeparator, formatFileSize } from '../utils/time'

defineEmits<{ back: [] }>()

const chatStore = useChatStore()
const userStore = useUserStore()

const showBack = computed(() => window.innerWidth < 768)
const canSend = computed(() => inputText.value.trim().length > 0 || selectedFile.value !== null)

const containerRef = ref<HTMLElement | null>(null)
const msgListRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const inputText = ref('')
const showEmoji = ref(false)
const sending = ref(false)
const loadingMore = ref(false)
const uploadProgress = ref(0)
const selectedFile = ref<File | null>(null)

const emojis = [
  '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗',
  '😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐',
  '😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲',
  '🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😱','🥵','🥶',
  '👍','👎','👏','🙌','🤝','❤️','🔥','🎉',
]

function isMine(msg: Message) {
  return msg.senderId === userStore.userId
}

function getBubbleClass(msg: Message): string {
  if (msg.msgType === 4) return 'emoji-bubble'
  return isMine(msg) ? 'bubble-mine' : 'bubble-theirs'
}

function shouldShowTime(msg: Message, index: number): boolean {
  if (index === 0) return true
  return shouldShowTimeSeparator(msg.createdAt, chatStore.messages[index - 1].createdAt)
}

async function scrollToBottom(smooth = false) {
  await nextTick()
  if (msgListRef.value) {
    msgListRef.value.scrollTo({ top: msgListRef.value.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }
}

watch(() => chatStore.messages.length, () => scrollToBottom(true))
watch(() => chatStore.currentContact?.userId, () => scrollToBottom(false))

function toggleEmoji() {
  showEmoji.value = !showEmoji.value
  if (showEmoji.value) {
    inputRef.value?.focus()
  }
}

function insertEmoji(emoji: string) {
  inputText.value += emoji
  inputRef.value?.focus()
}

async function sendText() {
  const text = inputText.value.trim()
  if (!text || sending.value) return
  sending.value = true
  showEmoji.value = false
  inputText.value = ''
  resetTextarea()

  const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]$/u
  const msgType = emojiRegex.test(text) ? 4 : 1
  chatStore.sendMessage(text, msgType as 1 | 4)
  await scrollToBottom(true)
  sending.value = false
}

function onFileSelect(e: Event) {
  const input = e.target as HTMLInputElement
  if (input.files?.[0]) {
    const file = input.files[0]
    if (file.size > 50 * 1024 * 1024) {
      alert('文件大小不能超过50MB')
      input.value = ''
      return
    }
    handleFile(file)
  }
  input.value = ''
}

async function handleFile(file: File) {
  sending.value = true
  uploadProgress.value = 0
  try {
    await chatStore.sendFile(file, p => { uploadProgress.value = p })
    await scrollToBottom(true)
  } catch {
    alert('文件上传失败')
  } finally {
    sending.value = false
    uploadProgress.value = 0
  }
}

function previewImage(url: string) { window.open(url, '_blank') }

function autoResize() {
  if (!inputRef.value) return
  inputRef.value.style.height = 'auto'
  inputRef.value.style.height = Math.min(inputRef.value.scrollHeight, 100) + 'px'
}

function resetTextarea() {
  if (inputRef.value) inputRef.value.style.height = 'auto'
}

// iOS keyboard handling
let vvHandler: (() => void) | null = null

function onFocus() {
  showEmoji.value = false
  // Listen to viewport changes
  if (window.visualViewport) {
    vvHandler = () => { scrollToBottom(false) }
    window.visualViewport.addEventListener('resize', vvHandler)
  }
  // Double scroll after keyboard animation
  setTimeout(() => scrollToBottom(false), 150)
  setTimeout(() => scrollToBottom(false), 600)
}

function onBlur() {
  if (window.visualViewport && vvHandler) {
    window.visualViewport.removeEventListener('resize', vvHandler)
    vvHandler = null
  }
}

async function onScroll() {
  if (!msgListRef.value) return
  if (msgListRef.value.scrollTop < 20 && chatStore.hasMore && !loadingMore.value) {
    await loadMore()
  }
}

async function loadMore() {
  if (!msgListRef.value || loadingMore.value) return
  loadingMore.value = true
  const prevH = msgListRef.value.scrollHeight
  await chatStore.loadMessages('loadMore')
  await nextTick()
  if (msgListRef.value) msgListRef.value.scrollTop = msgListRef.value.scrollHeight - prevH
  loadingMore.value = false
}
</script>

<style scoped>
.chat-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  height: 100dvh;
  overflow: hidden;
  background: #f5f5f5;
}

/* Header */
.chat-header {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  padding-top: calc(12px + env(safe-area-inset-top));
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
  flex-shrink: 0;
  min-height: 56px;
}
.back-btn {
  margin-right: 12px;
  padding: 4px;
  color: #666;
  background: none;
  border: none;
  cursor: pointer;
}
.header-info {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
}
.avatar-wrapper {
  position: relative;
  flex-shrink: 0;
}
.avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: linear-gradient(135deg, #60a5fa, #a78bfa);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  font-size: 14px;
}
.online-dot {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  background: #22c55e;
  border-radius: 50%;
  border: 2px solid #fff;
}
.name {
  font-weight: 500;
  font-size: 15px;
  color: #111;
}
.status {
  font-size: 12px;
  color: #999;
}
.no-contact {
  font-size: 14px;
  color: #999;
}

/* Messages */
.msg-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
  padding: 12px 16px;
}
.load-more {
  text-align: center;
  padding: 8px;
}
.load-more button {
  font-size: 13px;
  color: #3b82f6;
  background: none;
  border: none;
  cursor: pointer;
}
.time-sep {
  text-align: center;
  padding: 8px 0;
}
.time-sep span {
  font-size: 12px;
  color: #999;
  background: #f5f5f5;
  padding: 2px 8px;
  border-radius: 4px;
}
.msg-row {
  display: flex;
  margin-bottom: 4px;
}
.msg-row.mine {
  justify-content: flex-end;
  flex-direction: column;
  align-items: flex-end;
}
.msg-row.theirs {
  justify-content: flex-start;
}
.msg-bubble {
  max-width: 70%;
  padding: 8px 12px;
  border-radius: 18px;
  font-size: 15px;
  line-height: 1.4;
  word-break: break-word;
}
.bubble-mine {
  background: #95ec69;
  color: #111;
  border-bottom-right-radius: 4px;
}
.bubble-theirs {
  background: #fff;
  color: #111;
  border-bottom-left-radius: 4px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.06);
}
.emoji-bubble {
  background: transparent;
  padding: 4px;
}
.big-emoji {
  font-size: 48px;
  line-height: 1.2;
}
.msg-img {
  max-width: 220px;
  max-height: 280px;
  border-radius: 12px;
  cursor: pointer;
  display: block;
}
.msg-file {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #2563eb;
  text-decoration: none;
}
.file-name {
  font-size: 14px;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-size {
  font-size: 12px;
  color: #999;
}
.read-status {
  font-size: 11px;
  color: #999;
  margin-top: 2px;
  padding-right: 4px;
}
.empty-msg {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #999;
  font-size: 14px;
}

/* Emoji panel */
.emoji-panel {
  background: #fff;
  border-top: 1px solid #e5e5e5;
}
.emoji-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  font-size: 13px;
  color: #666;
  border-bottom: 1px solid #f0f0f0;
}
.emoji-close {
  background: none;
  border: none;
  color: #999;
  font-size: 16px;
  cursor: pointer;
  padding: 4px;
}
.emoji-grid {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 2px;
  padding: 8px 12px;
  max-height: 200px;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.emoji-btn {
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  background: none;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.emoji-btn:active {
  background: #f0f0f0;
}

/* Toolbar */
.toolbar {
  background: #fff;
  border-top: 1px solid #e5e5e5;
  flex-shrink: 0;
  padding-bottom: env(safe-area-inset-bottom);
}
.upload-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
}
.upload-track {
  flex: 1;
  height: 3px;
  background: #e5e5e5;
  border-radius: 2px;
  overflow: hidden;
}
.upload-fill {
  height: 100%;
  background: #3b82f6;
  transition: width 0.2s;
}
.upload-pct {
  font-size: 12px;
  color: #999;
  flex-shrink: 0;
}
.toolbar-row {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  padding: 8px 12px;
}
.tool-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  cursor: pointer;
  border-radius: 8px;
  -webkit-tap-highlight-color: transparent;
}
.tool-btn:active, .tool-btn.active {
  background: #f0f0f0;
}
.tool-icon {
  width: 22px;
  height: 22px;
  font-size: 22px;
  color: #666;
}
.input-wrap {
  flex: 1;
  min-width: 0;
}
.chat-input {
  width: 100%;
  resize: none;
  border: 1px solid #e0e0e0;
  border-radius: 20px;
  padding: 8px 14px;
  font-size: 16px !important;
  line-height: 1.4;
  max-height: 100px;
  outline: none;
  background: #fff;
  -webkit-appearance: none;
  box-sizing: border-box;
}
.chat-input:focus {
  border-color: #3b82f6;
}
.send-btn {
  flex-shrink: 0;
  height: 36px;
  padding: 0 16px;
  border: none;
  border-radius: 18px;
  background: #3b82f6;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.send-btn:active {
  background: #2563eb;
}
.send-btn.disabled {
  background: #c0c0c0;
  cursor: default;
}

/* Slide up transition */
.slide-up-enter-active, .slide-up-leave-active {
  transition: all 0.2s ease;
}
.slide-up-enter-from, .slide-up-leave-to {
  transform: translateY(100%);
  opacity: 0;
}
</style>
