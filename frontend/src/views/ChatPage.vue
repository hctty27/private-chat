<template>
  <div class="chat-page">
    <!-- 侧边栏 -->
    <aside class="sidebar">
      <ContactList
        :contacts="chatStore.sortedContacts"
        :current-id="chatStore.currentContact?.userId ?? null"
        :ws-connected="chatStore.wsConnected"
        @select="pickContact"
        @logout="logout"
      />
    </aside>

    <!-- 主区域 -->
    <main class="chat-main">
      <!-- 有联系人时 -->
      <template v-if="chatStore.currentContact">
        <!-- Header -->
        <div class="chat-head">
          <div class="ch-avatar">{{ chatStore.currentContact.nickname[0] }}</div>
          <div class="ch-info">
            <div class="ch-name">{{ chatStore.currentContact.nickname }}</div>
            <div class="ch-status">{{ chatStore.currentContact.online ? '在线' : '离线' }}</div>
          </div>
        </div>

        <!-- WS 断连提示 -->
        <div v-if="!chatStore.wsConnected" class="ws-bar">连接已断开，正在重连...</div>

        <!-- 消息列表 -->
        <div ref="listEl" class="msg-scroll">
          <div class="msg-content" :style="scroll.loadMoreStyle.value">
            <div class="load-more">
              <span class="spinner" v-if="scroll.loading.value"></span>
              <span class="load-text" v-if="scroll.loading.value">加载历史消息...</span>
              <span class="load-text" v-else-if="chatStore.hasMore">↑ 上拉加载更多</span>
              <span class="load-text" v-else-if="chatStore.messages.length > 0">没有更早的消息了</span>
            </div>

            <div v-for="(m, i) in chatStore.messages" :key="m.id">
              <div v-if="showTime(m, i)" class="time-bar">
                <span>{{ fmtChatTime(m.createdAt) }}</span>
              </div>
              <div class="msg" :class="m.senderId === uid ? 'right' : 'left'" :data-msg-id="m.id">
                <div class="bubble" :class="bubbleType(m)">
                  <template v-if="m.msgType === 1">{{ m.content }}</template>
                  <template v-else-if="m.msgType === 4"><span class="emoji-big">{{ m.content }}</span></template>
                  <template v-else-if="m.msgType === 2 && m.fileUrl">
                    <img :src="m.fileUrl" class="pic" @click="openPreview(m.fileUrl!, 'image')" />
                  </template>
                  <template v-else-if="m.msgType === 5 && m.fileUrl">
                    <a :href="m.fileUrl" :target="isIOS ? '_self' : '_blank'" rel="noopener" class="video-link">
                       {{ m.fileName }}
                      <small v-if="m.fileSize">{{ fmtSize(m.fileSize) }}</small>
                    </a>
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

        <!-- 表情面板 -->
        <div v-if="emojiOpen" class="emoji-box">
          <div class="emoji-head">
            <span>表情</span>
            <button @click="emojiOpen = false">✕</button>
          </div>
          <div class="emoji-list">
            <button v-for="e in emojiList" :key="e" @click="addEmoji(e)">{{ e }}</button>
          </div>
        </div>

        <!-- 输入栏 -->
        <div class="input-bar">
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
            />
            <button class="sbtn" :disabled="!text.trim()" @click="send">发送</button>
          </div>
        </div>
      </template>

      <!-- 未选择联系人 -->
      <div v-else class="empty-state">
        <div class="empty-icon">💬</div>
        <div class="empty-title">私聊</div>
        <div class="empty-desc">选择一个联系人开始聊天</div>
      </div>
    </main>

    <!-- 媒体预览弹窗 -->
    <MediaPreview
      :visible="previewVisible"
      :url="previewUrl"
      :type="previewType"
      @close="previewVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { useChatStore } from '../stores/chat'
import { useUserStore } from '../stores/user'
import { useChatScroll } from '../composables/useChatScroll'
import type { Message } from '../types'
import { formatChatTime as fmtChatTime, shouldShowTimeSeparator, formatFileSize as fmtSize } from '../utils/time'
import { useRouter } from 'vue-router'
import ContactList from '../components/ContactList.vue'
import MediaPreview from '../components/MediaPreview.vue'

const chatStore = useChatStore()
const userStore = useUserStore()
const router = useRouter()
const uid = computed(() => userStore.userId)

const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const text = ref('')
const emojiOpen = ref(false)
const progress = ref(0)

const previewVisible = ref(false)
const previewUrl = ref('')
const previewType = ref<'image' | 'video'>('image')
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

const scroll = useChatScroll(listEl, uid)

// ========== Lifecycle ==========
onMounted(async () => {
  await chatStore.loadContacts()
  chatStore.connectWs()
})

// ========== Watchers ==========
watch(() => chatStore.currentContact?.userId, () => {
  scroll.onContactChange()
})
watch(listEl, (el) => { scroll.onListReady(el) })
watch(() => chatStore.messages.length, () => {
  scroll.onMessagesChange()
})

// ========== Actions ==========
async function pickContact(id: number) {
  await chatStore.selectContact(id)
  scroll.onSelectContact()
}

function showTime(m: Message, i: number) {
  if (i === 0) return true
  return shouldShowTimeSeparator(m.createdAt, chatStore.messages[i - 1].createdAt)
}
function bubbleType(m: Message) {
  if (m.msgType === 4) return 'emoji'
  return m.senderId === uid.value ? 'mine' : 'his'
}
function openPreview(url: string, type: 'image' | 'video') {
  previewUrl.value = url
  previewType.value = type
  previewVisible.value = true
}
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
  scroll.scrollToBottom(true)
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
    scroll.scrollToBottom(true)
  } catch { alert('上传失败') }
  progress.value = 0
}

function grow() {
  if (!inputEl.value) return
  inputEl.value.style.height = 'auto'
  inputEl.value.style.height = Math.min(inputEl.value.scrollHeight, 100) + 'px'
}

const emojiList = [
  '😀','😁','😂','🤣','😃','😄','😅','😆','😉','😊','😋','😎','😍','🥰','😘','😗',
  '😙','😚','🙂','🤗','🤩','🤔','🤨','😐','😑','😶','🙄','😏','😣','😥','😮','🤐',
  '😯','😪','😫','😴','😌','😛','😜','😝','🤤','😒','😓','😔','😕','🙃','🤑','😲',
  '🙁','😖','😞','😟','😤','😢','😭','😦','😧','😨','😩','🤯','😬','😱','🥵','🥶',
  '👍','👎','👏','🙌','🤝','❤️','🔥','🎉',
]
</script>

<style>
html, body, #app {
  margin: 0; padding: 0;
  width: 100%; height: 100%;
  overflow: hidden;
  position: fixed;
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

.chat-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* Chat view */
.chat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  background: #fff;
  border-bottom: 1px solid #e5e5e5;
  flex-shrink: 0;
  min-height: 52px;
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

/* WS bar */
.ws-bar {
  background: #fef3c7; color: #92400e;
  font-size: 13px; text-align: center;
  padding: 6px; flex-shrink: 0;
}

/* Messages */
.msg-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  background: #ededed;
}
.load-more {
  text-align: center; padding: 12px 8px; min-height: 20px;
  display: flex; align-items: center; justify-content: center; gap: 8px;
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
.video-link { color: #576b95; font-size: 14px; text-decoration: none; display: block; }
.video-link small { display: block; color: #999; font-size: 12px; }
.file-link { color: #576b95; font-size: 14px; text-decoration: none; display: block; }
.file-link small { display: block; color: #999; font-size: 12px; }

.read-tag { font-size: 11px; color: #b0b0b0; margin-top: 2px; padding-right: 2px; }
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
  max-height: 170px; overflow-y: auto;
}
.emoji-list button {
  width: 100%; aspect-ratio: 1; font-size: 24px;
  background: none; border: none; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  border-radius: 6px;
}
.emoji-list button:hover { background: #f0f0f0; }

/* Input */
.input-bar {
  background: #fff; border-top: 1px solid #e5e5e5; flex-shrink: 0;
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
  border-radius: 6px;
}
.ibtn:hover { background: #f0f0f0; }
.ibtn.on { background: #f0f0f0; }
.txt {
  flex: 1; border: 1px solid #ddd; border-radius: 8px;
  padding: 8px 12px; font-size: 15px; resize: none;
  outline: none; line-height: 1.4; max-height: 100px;
}
.txt:focus { border-color: #07c160; }
.sbtn {
  width: 56px; height: 36px; flex-shrink: 0;
  background: #07c160; color: #fff; border: none;
  border-radius: 8px; font-size: 14px; font-weight: 500;
  cursor: pointer;
}
.sbtn:disabled { background: #ccc; }
.sbtn:not(:disabled):hover { background: #06ad56; }
</style>
