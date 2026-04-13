<template>
  <div class="flex flex-col h-full overflow-hidden">
    <!-- Chat header - fixed -->
    <div class="px-4 py-3 bg-white border-b flex items-center flex-shrink-0 safe-area-top">
      <button
        v-if="showBack"
        class="md:hidden mr-3 p-1 -ml-1 text-gray-500 hover:text-gray-700"
        @click="$emit('back')"
      >
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div v-if="chatStore.currentContact" class="flex items-center gap-3 flex-1">
        <div class="relative">
          <div class="w-9 h-9 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm">
            {{ chatStore.currentContact.nickname[0] }}
          </div>
          <div
            v-if="chatStore.currentContact.online"
            class="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-white"
          ></div>
        </div>
        <div>
          <div class="font-medium text-sm text-gray-900">{{ chatStore.currentContact.nickname }}</div>
          <div class="text-xs text-gray-400">{{ chatStore.currentContact.online ? '在线' : '离线' }}</div>
        </div>
      </div>
      <div v-else class="text-sm text-gray-400">选择一个联系人开始聊天</div>
    </div>

    <!-- Messages area - ONLY this scrolls -->
    <div
      v-if="chatStore.currentContact"
      ref="messagesContainer"
      class="flex-1 overflow-y-auto px-4 py-3 space-y-1 bg-gray-50"
      @scroll="onScroll"
    >
      <!-- Load more -->
      <div v-if="chatStore.hasMore" class="text-center py-2">
        <button
          class="text-xs text-blue-500 hover:text-blue-600"
          :class="{ 'opacity-50 pointer-events-none': loadingMore }"
          @click="loadMore"
        >
          {{ loadingMore ? '加载中...' : '加载更多' }}
        </button>
      </div>

      <template v-for="(msg, index) in chatStore.messages" :key="msg.id">
        <!-- Time separator -->
        <div
          v-if="shouldShowTime(msg, index)"
          class="text-center py-2"
        >
          <span class="text-xs text-gray-400 bg-gray-50 px-2 py-1 rounded">
            {{ formatChatTime(msg.createdAt) }}
          </span>
        </div>

        <!-- Message bubble -->
        <div
          class="flex"
          :class="msg.senderId === userStore.userId ? 'justify-end' : 'justify-start'"
        >
          <div
            class="max-w-[70%] flex flex-col"
            :class="msg.senderId === userStore.userId ? 'items-end' : 'items-start'"
          >
            <div
              class="rounded-2xl px-3 py-2 text-sm break-words"
              :class="getBubbleClass(msg)"
            >
              <!-- Text -->
              <template v-if="msg.msgType === 1">
                {{ msg.content }}
              </template>

              <!-- Emoji (large) -->
              <template v-else-if="msg.msgType === 4">
                <span class="text-4xl">{{ msg.content }}</span>
              </template>

              <!-- Image -->
              <template v-else-if="msg.msgType === 2 && msg.fileUrl">
                <img
                  :src="msg.fileUrl"
                  class="max-w-[250px] max-h-[300px] rounded-lg cursor-pointer"
                  @click="previewImage(msg.fileUrl!)"
                />
              </template>

              <!-- File -->
              <template v-else-if="msg.msgType === 3 && msg.fileUrl">
                <a
                  :href="msg.fileUrl"
                  target="_blank"
                  download
                  class="flex items-center gap-2 text-blue-600 hover:text-blue-700"
                >
                  <svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                  <div class="min-w-0">
                    <div class="text-sm truncate max-w-[180px]">{{ msg.fileName }}</div>
                    <div class="text-xs text-gray-400">{{ formatFileSize(msg.fileSize) }}</div>
                  </div>
                </a>
              </template>
            </div>

            <!-- Read status for last sent message -->
            <span
              v-if="msg.senderId === userStore.userId && index === chatStore.messages.length - 1"
              class="text-xs text-gray-400 mt-1"
            >
              {{ msg.isRead ? '已读' : '未读' }}
            </span>
          </div>
        </div>
      </template>

      <!-- Empty state -->
      <div v-if="chatStore.messages.length === 0" class="flex items-center justify-center h-full text-gray-400 text-sm">
        发送第一条消息吧
      </div>
    </div>

    <!-- No contact selected -->
    <div v-else class="flex-1 flex items-center justify-center text-gray-400 text-sm">
      选择一个联系人开始聊天
    </div>

    <!-- Input area - fixed at bottom -->
    <div v-if="chatStore.currentContact" class="bg-white border-t px-3 py-2 flex-shrink-0 safe-area-bottom">
      <!-- Upload progress -->
      <div v-if="uploadProgress > 0 && uploadProgress < 100" class="mb-2">
        <div class="h-1 bg-gray-200 rounded-full overflow-hidden">
          <div class="h-full bg-blue-500 transition-all" :style="{ width: uploadProgress + '%' }"></div>
        </div>
        <div class="text-xs text-gray-400 text-right mt-0.5">{{ uploadProgress }}%</div>
      </div>

      <div class="flex items-end gap-2">
        <!-- Emoji button -->
        <button
          class="p-2 text-gray-400 hover:text-gray-600 flex-shrink-0"
          @click="showEmoji = !showEmoji"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>

        <!-- File upload -->
        <button
          class="p-2 text-gray-400 hover:text-gray-600 flex-shrink-0"
          @click="fileInputRef?.click()"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <input
          ref="fileInputRef"
          type="file"
          class="hidden"
          @change="onFileSelect"
        />

        <!-- Text input -->
        <div class="flex-1 relative">
          <textarea
            ref="inputRef"
            v-model="inputText"
            rows="1"
            class="ios-input w-full resize-none border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:border-blue-400 max-h-[100px]"
            placeholder="输入消息..."
            @keydown.enter.exact.prevent="sendText"
            @input="autoResize"
            @focus="onInputFocus"
            @blur="onInputBlur"
          ></textarea>
        </div>

        <!-- Send button -->
        <el-button
          type="primary"
          size="small"
          :disabled="!inputText.trim() && !selectedFile"
          :loading="sending"
          class="flex-shrink-0"
          style="border-radius: 12px;"
          @click="sendText"
        >
          发送
        </el-button>
      </div>

      <!-- Emoji picker -->
      <EmojiPicker v-if="showEmoji" @select="onEmojiSelect" @close="showEmoji = false" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, computed } from 'vue'
import { useChatStore } from '../stores/chat'
import { useUserStore } from '../stores/user'
import type { Message } from '../types'
import { formatChatTime, shouldShowTimeSeparator, formatFileSize } from '../utils/time'
import EmojiPicker from './EmojiPicker.vue'

defineEmits<{
  back: []
}>()

const chatStore = useChatStore()
const userStore = useUserStore()

const showBack = computed(() => window.innerWidth < 768)

const messagesContainer = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)
const inputText = ref('')
const showEmoji = ref(false)
const sending = ref(false)
const loadingMore = ref(false)
const uploadProgress = ref(0)
const selectedFile = ref<File | null>(null)

// Scroll to bottom
async function scrollToBottom(smooth = false) {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTo({
      top: messagesContainer.value.scrollHeight,
      behavior: smooth ? 'smooth' : 'auto',
    })
  }
}

// Watch for new messages and scroll
watch(
  () => chatStore.messages.length,
  () => {
    scrollToBottom(true)
  }
)

// Watch for contact change
watch(
  () => chatStore.currentContact?.userId,
  () => {
    scrollToBottom(false)
  }
)

function shouldShowTime(msg: Message, index: number): boolean {
  if (index === 0) return true
  const prevMsg = chatStore.messages[index - 1]
  return shouldShowTimeSeparator(msg.createdAt, prevMsg.createdAt)
}

function getBubbleClass(msg: Message): string {
  const isMine = msg.senderId === userStore.userId
  if (msg.msgType === 4) return 'bg-transparent'
  return isMine
    ? 'bg-green-500 text-white rounded-br-sm'
    : 'bg-white text-gray-800 rounded-bl-sm shadow-sm'
}

async function sendText() {
  const text = inputText.value.trim()
  if (!text) return

  sending.value = true
  inputText.value = ''
  resetTextareaHeight()
  showEmoji.value = false

  // Check if the text is a single emoji
  const emojiRegex = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]$/u
  const msgType = emojiRegex.test(text) ? (4 as const) : (1 as const)

  chatStore.sendMessage(text, msgType)
  await scrollToBottom(true)
  sending.value = false
}

function onEmojiSelect(emoji: string) {
  inputText.value += emoji
  inputRef.value?.focus()
}

function onFileSelect(event: Event) {
  const input = event.target as HTMLInputElement
  if (input.files && input.files[0]) {
    const file = input.files[0]
    if (file.size > 50 * 1024 * 1024) {
      alert('文件大小不能超过50MB')
      input.value = ''
      return
    }
    handleFileUpload(file)
  }
  input.value = ''
}

async function handleFileUpload(file: File) {
  sending.value = true
  uploadProgress.value = 0
  try {
    await chatStore.sendFile(file, (p) => {
      uploadProgress.value = p
    })
    await scrollToBottom(true)
  } catch (e) {
    alert('文件上传失败')
  } finally {
    sending.value = false
    uploadProgress.value = 0
  }
}

function previewImage(url: string) {
  window.open(url, '_blank')
}

function autoResize() {
  if (!inputRef.value) return
  inputRef.value.style.height = 'auto'
  const maxH = 100
  inputRef.value.style.height = Math.min(inputRef.value.scrollHeight, maxH) + 'px'
}

function resetTextareaHeight() {
  if (inputRef.value) {
    inputRef.value.style.height = 'auto'
  }
}

// iOS: handle keyboard showing/hiding
function onInputFocus() {
  // Use visualViewport to reliably detect keyboard
  if (window.visualViewport) {
    const vv = window.visualViewport
    const onResize = () => {
      // Keep scrolling to bottom as viewport shrinks
      scrollToBottom(false)
    }
    vv.addEventListener('resize', onResize)
    // Store cleanup function
    ;(inputRef.value as any).__vvCleanup = () => vv.removeEventListener('resize', onResize)
  }
  // Fallback: scroll into view after keyboard animation
  setTimeout(() => {
    inputRef.value?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    scrollToBottom(false)
  }, 100)
  setTimeout(() => {
    inputRef.value?.scrollIntoView({ block: 'end', behavior: 'smooth' })
    scrollToBottom(false)
  }, 500)
}

function onInputBlur() {
  // Cleanup visualViewport listener
  if (inputRef.value && (inputRef.value as any).__vvCleanup) {
    ;(inputRef.value as any).__vvCleanup()
    delete (inputRef.value as any).__vvCleanup
  }
  window.scrollTo(0, 0)
}

async function onScroll() {
  if (!messagesContainer.value) return
  if (messagesContainer.value.scrollTop < 20 && chatStore.hasMore && !loadingMore.value) {
    await loadMore()
  }
}

async function loadMore() {
  if (!messagesContainer.value || loadingMore.value) return
  loadingMore.value = true
  const prevHeight = messagesContainer.value.scrollHeight
  await chatStore.loadMessages('loadMore')
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight - prevHeight
  }
  loadingMore.value = false
}
</script>

<style scoped>
/* iOS safe area */
.safe-area-top {
  padding-top: env(safe-area-inset-top);
}
.safe-area-bottom {
  padding-bottom: calc(0.5rem + env(safe-area-inset-bottom));
}

/* Prevent iOS bounce scroll on the whole container */
:host,
.flex.flex-col.h-full {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  overflow: hidden;
}

/* Only message area scrolls, with momentum */
.overflow-y-auto {
  -webkit-overflow-scrolling: touch;
  overscroll-behavior: contain;
}

/* iOS: font-size 16px prevents auto-zoom on focus */
.ios-input {
  font-size: 16px !important;
  line-height: 1.4;
}

/* iOS: prevent viewport shift when keyboard appears */
@supports (-webkit-touch-callout: none) {
  .flex.flex-col.h-full {
    height: 100dvh;
  }
}
</style>
