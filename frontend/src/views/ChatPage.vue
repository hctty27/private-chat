<template>
  <div class="chat-page">
    <aside class="sidebar">
      <ContactList
        :contacts="chatStore.sortedContacts"
        :current-id="chatStore.currentContact?.userId ?? null"
        :ws-connected="chatStore.wsConnected"
        @select="pickContact"
        @logout="logout"
      />
    </aside>

    <main
      class="chat-main"
      @paste="onPaste"
      @dragenter.prevent="onDragEnter"
      @dragover.prevent
      @dragleave.prevent="onDragLeave"
      @drop="onDrop"
    >
      <template v-if="chatStore.currentContact">
        <div class="chat-head">
          <div class="ch-avatar">{{ chatStore.currentContact.nickname[0] }}</div>
          <div class="ch-info">
            <div class="ch-name">{{ chatStore.currentContact.nickname }}</div>
            <div class="ch-status">{{ chatStore.currentContact.online ? '在线' : formatLastSeen(chatStore.currentContact.lastSeenAt) }}</div>
          </div>
        </div>

        <ConnectionNotice
          :status="chatStore.wsStatus"
          :recovered-notice="chatStore.recoveredNotice"
          :pending-count="chatStore.pendingChatCount"
          @reconnect="chatStore.reconnectNow"
        />

        <div ref="listEl" class="msg-scroll">
          <div class="load-more">
            <template v-if="scroll.loading.value">
              <span class="spinner"></span>
              <span class="load-text">加载历史消息...</span>
            </template>
            <button
              v-else-if="scroll.loadMoreError.value"
              type="button"
              class="load-retry"
              @click.stop="scroll.retryLoadMore"
            >
              {{ scroll.loadMoreError.value }}
            </button>
            <span class="load-text" v-else-if="chatStore.hasMore">↑ 上拉加载更多</span>
            <span class="load-text" v-else-if="chatStore.messages.length > 0">没有更早的消息了</span>
          </div>

          <ConversationMessageState
            :state="chatStore.messageLoadState"
            :has-messages="chatStore.messages.length > 0"
            :error="chatStore.messageLoadError"
            @retry="retryInitialMessages"
          />

          <div
            v-if="chatStore.messages.length > 0"
            class="virtual-list"
            :style="{ height: scroll.virtualizer.value.getTotalSize() + 'px', position: 'relative' }"
          >
            <div
              v-for="vi in scroll.virtualizer.value.getVirtualItems()"
              :key="String(vi.key)"
              :ref="scroll.measureItem"
              class="virtual-item"
              :data-index="vi.index"
              :style="{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start}px)` }"
              :data-msg-id="chatStore.messages[vi.index]?.id"
            >
              <div v-if="showTimeByIndex(vi.index)" class="time-bar">
                <span>{{ fmtChatTime(chatStore.messages[vi.index].createdAt) }}</span>
              </div>
              <div
                class="msg"
                :class="chatStore.messages[vi.index].senderId === uid ? 'right' : 'left'"
                tabindex="0"
                @contextmenu="openMessageMenu($event, chatStore.messages[vi.index])"
                @keydown.shift.f10.prevent="openMessageMenuFromElement($event, chatStore.messages[vi.index])"
              >
                <div class="bubble" :class="bubbleType(chatStore.messages[vi.index])">
                  <template v-if="chatStore.messages[vi.index].msgType === 1">{{ chatStore.messages[vi.index].content }}</template>
                  <template v-else-if="chatStore.messages[vi.index].msgType === 4"><span class="emoji-big">{{ chatStore.messages[vi.index].content }}</span></template>
                  <template v-else-if="chatStore.messages[vi.index].msgType === 2 && chatStore.messages[vi.index].fileUrl">
                    <div class="pic-shell">
                      <img
                        :src="chatStore.messages[vi.index].fileId ? `/api/files/${chatStore.messages[vi.index].fileId}/thumbnail` : chatStore.messages[vi.index].fileUrl ?? undefined"
                        loading="lazy"
                        decoding="async"
                        class="pic"
                        @load="onImageLoaded"
                        @error="fallbackImageToOriginal($event, chatStore.messages[vi.index])"
                        @click="openPreview(chatStore.messages[vi.index].fileUrl!, 'image')"
                      />
                    </div>
                  </template>
                  <template v-else-if="chatStore.messages[vi.index].msgType === 5 && chatStore.messages[vi.index].fileUrl">
                    <a :href="chatStore.messages[vi.index].fileUrl ?? undefined" :target="isIOS ? '_self' : '_blank'" rel="noopener" class="video-link">
                      {{ chatStore.messages[vi.index].fileName }}
                      <small v-if="chatStore.messages[vi.index].fileSize">{{ fmtSize(chatStore.messages[vi.index].fileSize!) }}</small>
                    </a>
                  </template>
                  <template v-else-if="chatStore.messages[vi.index].msgType === 3 && chatStore.messages[vi.index].fileUrl">
                    <a :href="chatStore.messages[vi.index].fileUrl ?? undefined" target="_blank" download class="file-link">
                      📎 {{ chatStore.messages[vi.index].fileName }}
                      <small>{{ fmtSize(chatStore.messages[vi.index].fileSize!) }}</small>
                    </a>
                  </template>
                  <template v-else-if="isPendingMediaMessage(chatStore.messages[vi.index])">
                    <div class="media-fallback">
                      <span>{{ pendingMediaText(chatStore.messages[vi.index]) }}</span>
                      <small v-if="chatStore.messages[vi.index].msgType === 3 && chatStore.messages[vi.index].fileSize">{{ fmtSize(chatStore.messages[vi.index].fileSize!) }}</small>
                    </div>
                  </template>
                </div>
                <div v-if="shouldShowMessageStatus(vi.index)" class="read-tag">
                  <MessageStatusIndicator
                    :status="chatStore.messages[vi.index].localStatus"
                    :is-read="chatStore.messages[vi.index].isRead === 1"
                    :progress="chatStore.messages[vi.index].uploadProgress"
                    :error="chatStore.messages[vi.index].localError"
                    :show-read-state="!chatStore.messages[vi.index].localStatus && isLastSelfMessage(vi.index)"
                    @retry="retryMessageByClientId(chatStore.messages[vi.index]?.clientMsgId)"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        <NewMessageButton
          :visible="scroll.showBottomButton.value"
          :count="scroll.newMessageCount.value"
          @click="scroll.scrollToBottomAndClear(true)"
        />

        <div v-if="emojiOpen" class="emoji-box">
          <div class="emoji-head">
            <span>表情</span>
            <button class="tap-target" type="button" @click="emojiOpen = false">✕</button>
          </div>
          <div class="emoji-list">
            <button v-for="e in emojiList" :key="e" type="button" @click="addEmoji(e)">{{ e }}</button>
          </div>
        </div>

        <div class="input-bar">
          <div v-if="progress > 0 && progress < 100" class="prog">
            <div class="prog-fill" :style="{ width: progress + '%' }"></div>
          </div>
          <div class="input-row">
            <button class="ibtn tap-target" :class="{ on: emojiOpen }" type="button" @click="emojiOpen = !emojiOpen">😊</button>
            <button class="ibtn tap-target" type="button" :disabled="uploadBusy" @click="fileEl?.click()">＋</button>
            <input ref="fileEl" type="file" multiple hidden @change="onFile" />
            <textarea
              ref="inputEl"
              v-model="text"
              rows="1"
              class="txt"
              placeholder="输入消息..."
              @keydown.enter.exact.prevent="send"
              @input="grow"
            />
            <button class="sbtn tap-target" type="button" :disabled="!text.trim()" @click="send">发送</button>
          </div>
        </div>

        <div v-if="dragActive" class="drag-overlay" aria-hidden="true">
          <div class="drag-overlay-card">松开以发送文件</div>
        </div>
      </template>

      <div v-else class="empty-state">
        <div class="empty-icon">💬</div>
        <div class="empty-title">私聊</div>
        <div class="empty-desc">选择一个联系人开始聊天</div>
      </div>
    </main>

    <MediaPreview
      :visible="previewVisible"
      :url="previewUrl"
      :type="previewType"
      @close="previewVisible = false"
    />

    <AttachmentSendDialog
      :visible="!!attachmentComposer.staged.value"
      :files="attachmentComposer.staged.value?.files ?? []"
      :recipient-name="attachmentComposer.staged.value?.recipient.nickname ?? ''"
      :busy="uploadBusy"
      @cancel="attachmentComposer.cancel"
      @confirm="confirmAttachment"
    />

    <MessageActionMenu
      :visible="actionMenuVisible"
      :actions="actionMenuActions"
      :x="actionMenuX"
      :y="actionMenuY"
      @action="handleMessageAction"
      @close="closeMessageMenu"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { useRouter } from 'vue-router'
import { useChatStore } from '../stores/chat'
import { useUserStore } from '../stores/user'
import { useChatScroll } from '../composables/useChatScroll'
import { useChatDrafts } from '../composables/useChatDrafts'
import { useAttachmentComposer } from '../composables/useAttachmentComposer'
import { useAttachmentIngress } from '../composables/useAttachmentIngress'
import { useConversationScrollMemory } from '../composables/useConversationScrollMemory'
import { formatChatTime as fmtChatTime, formatLastSeen, shouldShowTimeSeparator, formatFileSize as fmtSize } from '../utils/time'
import { getMessageActions, type MessageAction } from '../utils/messageActions'
import ContactList from '../components/ContactList.vue'
import ConnectionNotice from '../components/ConnectionNotice.vue'
import ConversationMessageState from '../components/ConversationMessageState.vue'
import MediaPreview from '../components/MediaPreview.vue'
import MessageStatusIndicator from '../components/MessageStatusIndicator.vue'
import NewMessageButton from '../components/NewMessageButton.vue'
import AttachmentSendDialog from '../components/AttachmentSendDialog.vue'
import MessageActionMenu from '../components/MessageActionMenu.vue'
import type { Message } from '../types'

const chatStore = useChatStore()
const userStore = useUserStore()
const router = useRouter()
const uid = computed(() => userStore.userId)
const drafts = useChatDrafts()
const scrollMemory = useConversationScrollMemory()

const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const emojiOpen = ref(false)
const progress = ref(0)
const uploadBusy = ref(false)
const previewVisible = ref(false)
const previewUrl = ref('')
const previewType = ref<'image' | 'video'>('image')
const dragActive = ref(false)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)

const actionMenuVisible = ref(false)
const actionMenuActions = ref<MessageAction[]>([])
const actionMenuX = ref(0)
const actionMenuY = ref(0)
const actionMessage = ref<Message | null>(null)
const lastSelfMessageIndex = computed(() => {
  for (let index = chatStore.messages.length - 1; index >= 0; index--) {
    if (chatStore.messages[index].senderId === uid.value) return index
  }
  return -1
})
let selectionSeq = 0
let dragDepth = 0

const text = computed({
  get() {
    const contactId = chatStore.currentContact?.userId
    return contactId ? drafts.get(contactId) : ''
  },
  set(value: string) {
    const contactId = chatStore.currentContact?.userId
    if (contactId) drafts.set(contactId, value)
  },
})

function currentRecipient() {
  const contact = chatStore.currentContact
  return contact ? { id: contact.userId, nickname: contact.nickname } : null
}

const attachmentComposer = useAttachmentComposer({
  getCurrentRecipient: currentRecipient,
  onRecipientMismatch: () => ElMessage.warning('联系人已切换，请重新选择文件'),
})

const attachmentIngress = useAttachmentIngress({
  maxBytes: 50 * 1024 * 1024,
  maxFiles: 9,
  getRecipient: currentRecipient,
  onStage: (files, recipient) => {
    emojiOpen.value = false
    attachmentComposer.stage(files, recipient)
  },
  onWarning: (message) => ElMessage.warning(message),
})

const scroll = useChatScroll(listEl, uid)

onMounted(async () => {
  await chatStore.loadContacts()
  chatStore.connectWs()
})

onUnmounted(() => {
  scrollMemory.clearAll()
  dragActive.value = false
  dragDepth = 0
})

watch(() => chatStore.currentContact?.userId, () => {
  closeMessageMenu()
  nextTick(grow)
})
watch(listEl, (el) => { scroll.onListReady(el) })
watch(() => chatStore.messages.length, () => { scroll.onMessagesChange() })
watch(() => chatStore.messages, closeMessageMenu)

async function pickContact(id: number) {
  const seq = ++selectionSeq
  const previousId = chatStore.currentContact?.userId
  if (previousId) scrollMemory.remember(previousId, scroll.captureVisibleAnchor())

  await chatStore.selectContact(id)
  if (seq !== selectionSeq || chatStore.currentContact?.userId !== id) return

  await nextTick()
  if (seq !== selectionSeq) return
  scroll.onContactChange({ scrollToBottom: false })

  const anchor = scrollMemory.get(id)
  const restored = anchor ? await scroll.restoreVisibleAnchor(anchor) : false
  if (seq !== selectionSeq) return
  if (!restored) scroll.scrollToBottomAndClear(false)
}

async function retryInitialMessages() {
  const loaded = await chatStore.retryInitialMessages()
  if (loaded) scroll.scrollToBottomAndClear(false)
}

function showTimeByIndex(i: number) {
  if (i === 0) return true
  return shouldShowTimeSeparator(chatStore.messages[i].createdAt, chatStore.messages[i - 1].createdAt)
}

function isLastSelfMessage(index: number) {
  return index === lastSelfMessageIndex.value
}

function shouldShowMessageStatus(index: number) {
  const message = chatStore.messages[index]
  if (!message || message.senderId !== uid.value) return false
  return !!message.localStatus || isLastSelfMessage(index)
}

function isPendingMediaMessage(message: Message) {
  return (message.msgType === 2 || message.msgType === 3 || message.msgType === 5) && !message.fileUrl
}

function pendingMediaText(message: Message) {
  if (message.msgType === 2) return '📷 图片准备中'
  if (message.msgType === 5) return '🎬 视频准备中'
  return `📎 ${message.fileName || '文件准备中'}`
}

function bubbleType(message: { msgType: number; senderId: number }) {
  if (message.msgType === 4) return 'emoji'
  return message.senderId === uid.value ? 'mine' : 'his'
}

function onImageLoaded(event: Event) {
  const image = event.currentTarget
  if (image instanceof HTMLImageElement) image.classList.add('loaded')
}

function fallbackImageToOriginal(event: Event, message: Message) {
  const image = event.currentTarget
  if (!(image instanceof HTMLImageElement) || !message.fileId || !message.fileUrl) return
  if (image.dataset.originalFallback === '1') return
  image.dataset.originalFallback = '1'
  image.src = message.fileUrl
}

function openPreview(url: string, type: 'image' | 'video') {
  previewUrl.value = url
  previewType.value = type
  previewVisible.value = true
}

function logout() {
  drafts.clearAll()
  scrollMemory.clearAll()
  attachmentComposer.cancel()
  closeMessageMenu()
  chatStore.disconnectWs()
  userStore.logout()
  chatStore.clearState()
  router.replace('/')
}

function addEmoji(emoji: string) {
  text.value += emoji
  inputEl.value?.focus()
  nextTick(grow)
}

async function send() {
  const contactId = chatStore.currentContact?.userId
  const value = text.value.trim()
  if (!contactId || !value) return

  emojiOpen.value = false
  const isEmoji = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]$/u.test(value)
  chatStore.sendMessage(value, isEmoji ? 4 : 1)
  drafts.clear(contactId)
  await nextTick()
  if (inputEl.value) inputEl.value.style.height = 'auto'
  scroll.scrollToBottomAndClear(true)
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = ''
  if (files.length === 0 || uploadBusy.value) return
  attachmentIngress.acceptFiles(files)
}

function onPaste(event: ClipboardEvent) {
  attachmentIngress.handlePaste(event)
}

function hasDraggedFiles(event: DragEvent) {
  return Array.from(event.dataTransfer?.types ?? []).includes('Files')
}

function onDragEnter(event: DragEvent) {
  if (!hasDraggedFiles(event) || !chatStore.currentContact) return
  dragDepth += 1
  dragActive.value = true
}

function onDragLeave(event: DragEvent) {
  if (!hasDraggedFiles(event)) return
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragActive.value = false
}

function onDrop(event: DragEvent) {
  dragDepth = 0
  dragActive.value = false
  attachmentIngress.handleDrop(event)
}

async function confirmAttachment() {
  const files = attachmentComposer.takeConfirmed()
  if (!files?.length || uploadBusy.value) return
  uploadBusy.value = true
  try {
    await doUpload(files)
  } finally {
    uploadBusy.value = false
  }
}

async function doUpload(files: File[]) {
  const fileProgress = Array.from({ length: files.length }, () => 0)
  let followBatch = scroll.isNearBottom(160)
  progress.value = 0
  try {
    for (let index = 0; index < files.length; index++) {
      const sendPromise = chatStore.sendFile(files[index], (p) => {
        fileProgress[index] = p
        progress.value = Math.round(fileProgress.reduce((sum, value) => sum + value, 0) / files.length)
      })

      await nextTick()
      if (followBatch) scroll.scrollToBottomAndClear(false)

      await sendPromise
      await nextTick()
      if (followBatch && !scroll.isNearBottom(320)) followBatch = false
    }
  } finally {
    progress.value = 0
  }
}

function retryMessageByClientId(clientMsgId?: string) {
  if (!clientMsgId) return
  chatStore.retryMessage(clientMsgId)
  scroll.scrollToBottomAndClear(true)
}

function grow() {
  if (!inputEl.value) return
  inputEl.value.style.height = 'auto'
  const borderHeight = inputEl.value.offsetHeight - inputEl.value.clientHeight
  const contentHeight = inputEl.value.scrollHeight + borderHeight
  inputEl.value.style.height = Math.min(contentHeight, 100) + 'px'
  inputEl.value.style.overflowY = contentHeight > 100 ? 'auto' : 'hidden'
}

function openMessageMenu(event: MouseEvent, message: Message) {
  if (getMessageActions(message).length === 0) return
  event.preventDefault()
  openMessageMenuAt(event.clientX, event.clientY, message)
}

function openMessageMenuFromElement(event: KeyboardEvent, message: Message) {
  const element = event.currentTarget as HTMLElement | null
  const rect = element?.getBoundingClientRect()
  openMessageMenuAt(rect?.left ?? 8, rect?.bottom ?? 8, message)
}

function openMessageMenuAt(x: number, y: number, message: Message) {
  const actions = getMessageActions(message)
  if (actions.length === 0) return
  actionMessage.value = message
  actionMenuActions.value = actions
  actionMenuX.value = x
  actionMenuY.value = y
  actionMenuVisible.value = true
}

function closeMessageMenu() {
  actionMenuVisible.value = false
  actionMenuActions.value = []
  actionMessage.value = null
}

async function handleMessageAction(action: MessageAction) {
  const message = actionMessage.value
  if (!message) return

  if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(message.content ?? '')
    } catch {
      ElMessage.error('复制失败')
    }
    return
  }
  if (action === 'retry') {
    retryMessageByClientId(message.clientMsgId)
    return
  }
  if (action === 'view' && message.fileUrl) {
    openPreview(message.fileUrl, message.msgType === 2 ? 'image' : 'video')
    return
  }
  if (action === 'open' && message.fileUrl) {
    window.open(message.fileUrl, '_blank', 'noopener,noreferrer')
    return
  }
  if (action === 'save' && message.fileUrl) {
    const anchor = document.createElement('a')
    anchor.href = message.fileUrl
    anchor.download = message.fileName || 'download'
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }
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
html, body, #app { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; position: fixed; }
</style>

<style scoped>
.chat-page { display: flex; width: 100%; height: 100%; overflow: hidden; background: #ededed; }
.sidebar { width: 280px; flex-shrink: 0; border-right: 1px solid #e5e5e5; }
.chat-main { flex: 1; display: flex; flex-direction: column; min-width: 0; position: relative; }
.chat-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: #fff; border-bottom: 1px solid #e5e5e5; flex-shrink: 0; min-height: 52px; }
.ch-avatar { width: 34px; height: 34px; border-radius: 50%; background: linear-gradient(135deg, #60a5fa, #a78bfa); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 14px; flex-shrink: 0; }
.ch-info { display: flex; flex-direction: column; }
.ch-name { font-size: 15px; font-weight: 500; color: #111; }
.ch-status { font-size: 12px; color: #999; }
.msg-scroll { flex: 1; overflow-y: auto; padding: 12px; background: #ededed; }
:deep(.new-message-button) { position: absolute; right: 24px; bottom: 74px; z-index: 5; }
.load-more { text-align: center; height: 44px; padding: 0 8px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px; }
.load-text { font-size: 12px; color: #999; }
.load-retry { min-height: 32px; padding: 4px 10px; border: 0; background: transparent; color: #576b95; font-size: 12px; cursor: pointer; }
.load-retry:hover { text-decoration: underline; }
.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #ddd; border-top-color: #07c160; border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.time-bar { text-align: center; padding: 8px 0; }
.time-bar span { font-size: 12px; color: #b0b0b0; background: rgba(0,0,0,0.04); padding: 2px 10px; border-radius: 4px; }
.msg { display: flex; flex-direction: column; padding-bottom: 8px; outline: none; }
.msg:focus-visible { border-radius: 8px; box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.65); }
.msg.right { align-items: flex-end; }
.msg.left { align-items: flex-start; }
.bubble { max-width: 65%; padding: 9px 13px; border-radius: 12px; font-size: 15px; line-height: 1.5; word-break: break-word; }
.bubble.mine { background: #95ec69; color: #111; border-bottom-right-radius: 3px; }
.bubble.his { background: #fff; color: #111; border-bottom-left-radius: 3px; }
.bubble.emoji { background: transparent; padding: 2px 4px; }
.emoji-big { font-size: 52px; line-height: 1.2; }
.pic-shell { width: 200px; aspect-ratio: 4 / 3; overflow: hidden; border-radius: 8px; background: #f2f2f2; }
.pic { width: 100%; height: 100%; border-radius: inherit; display: block; object-fit: contain; opacity: 0; transition: opacity 120ms ease; cursor: pointer; }
.pic.loaded { opacity: 1; }
.video-link, .file-link { color: #576b95; font-size: 14px; text-decoration: none; display: block; }
.video-link small, .file-link small { display: block; color: #999; font-size: 12px; }
.media-fallback { min-width: 120px; padding: 10px 12px; border-radius: 8px; background: rgba(255,255,255,0.45); color: #576b95; font-size: 14px; }
.media-fallback small { display: block; margin-top: 2px; color: #999; font-size: 12px; }
.read-tag { font-size: 11px; color: #b0b0b0; margin-top: 2px; padding-right: 2px; }
.empty-tip { display: flex; align-items: center; justify-content: center; height: 100%; color: #999; font-size: 14px; }
.empty-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: #999; }
.empty-icon { font-size: 48px; margin-bottom: 12px; }
.empty-title { font-size: 18px; font-weight: 600; color: #333; margin-bottom: 4px; }
.empty-desc { font-size: 14px; }
.drag-overlay { position: absolute; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center; background: rgba(237,237,237,0.8); pointer-events: none; }
.drag-overlay-card { padding: 18px 28px; border: 2px dashed #07c160; border-radius: 12px; background: #fff; color: #2f855a; font-size: 15px; font-weight: 600; }
.emoji-box { background: #fff; border-top: 1px solid #e5e5e5; flex-shrink: 0; max-height: 220px; animation: slideUp .2s ease; }
@keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.emoji-head { display: flex; justify-content: space-between; align-items: center; padding: 8px 16px; font-size: 13px; color: #666; border-bottom: 1px solid #f0f0f0; }
.emoji-head button { background: none; border: none; color: #999; font-size: 16px; cursor: pointer; }
.emoji-list { display: grid; grid-template-columns: repeat(8, 1fr); gap: 0; padding: 8px; max-height: 170px; overflow-y: auto; }
.emoji-list button { width: 100%; aspect-ratio: 1; font-size: 24px; background: none; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 6px; }
.emoji-list button:hover { background: #f0f0f0; }
.input-bar { background: #fff; border-top: 1px solid #e5e5e5; flex-shrink: 0; }
.prog { padding: 0 16px; height: 3px; }
.prog-fill { height: 100%; background: #07c160; transition: width 0.2s; }
.input-row { display: flex; align-items: flex-end; gap: 6px; padding: 8px 12px; }
.ibtn { width: 36px; height: 36px; flex-shrink: 0; background: none; border: none; font-size: 20px; cursor: pointer; display: flex; align-items: center; justify-content: center; border-radius: 6px; }
.ibtn:hover, .ibtn.on { background: #f0f0f0; }
.ibtn:disabled { cursor: not-allowed; opacity: 0.45; }
.txt { flex: 1; border: 1px solid #ddd; border-radius: 8px; padding: 8px 12px; font-size: 15px; resize: none; outline: none; line-height: 1.4; max-height: 100px; }
.txt:focus { border-color: #07c160; }
.sbtn { width: 56px; height: 36px; flex-shrink: 0; background: #07c160; color: #fff; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
.sbtn:disabled { background: #ccc; }
.sbtn:not(:disabled):hover { background: #06ad56; }
</style>
