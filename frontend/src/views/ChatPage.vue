<template>
  <div class="chat-page">
    <aside class="sidebar">
      <ContactList
        :contacts="chatStore.sortedContacts"
        :current-id="chatStore.currentContact?.userId ?? null"
        :ws-connected="chatStore.wsConnected"
        :show-last-seen="false"
        @select="pickContact"
        @availability="availabilityVisible = true"
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
            <div class="ch-status" :title="chatStore.currentContact.availabilityNote || undefined">{{ formatContactPresence(chatStore.currentContact) }}</div>
          </div>
          <VoiceCallButton
            v-if="callStore.available"
            class="desktop-call-button"
            :disabled="!chatStore.wsConnected || chatStore.wsStatus !== 'connected' || callStore.phase !== 'idle'"
            @call="startCurrentCall"
          />
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
            class="message-list"
          >
            <div
              v-for="(message, index) in chatStore.messages"
              :key="message.clientMsgId || message.id"
              class="message-item"
              :data-index="index"
              :data-msg-id="message.id"
            >
              <div v-if="showTimeByIndex(index)" class="time-bar">
                <span>{{ fmtChatTime(message.createdAt) }}</span>
              </div>
              <div
                class="msg"
                :class="message.senderId === uid ? 'right' : 'left'"
                tabindex="0"
                @contextmenu="openMessageMenu($event, message)"
                @keydown.shift.f10.prevent="openMessageMenuFromElement($event, message)"
              >
                <div class="bubble" :class="[bubbleType(message), { 'visual-media': isStandaloneVisualMedia(message), 'voice-media': isStandaloneVoiceMessage(message) }]">
                  <MessageReplyQuote
                    v-if="message.replyTo"
                    :reply="message.replyTo"
                    :sender-name="replySenderName(message.replyTo.senderId)"
                    @jump="jumpToReply(message.replyTo.messageId)"
                  />
                  <template v-if="message.msgType === 1"><span class="message-text">{{ message.content }}</span></template>
                  <template v-else-if="message.msgType === 4"><span class="emoji-big">{{ message.content }}</span></template>
                  <MediaMessageCard
                    v-else-if="isRichMediaMessage(message)"
                    :message="message"
                    :lazy-image="true"
                    @open="openMediaFromBubble"
                    @retry="retryMessageByClientId(message.clientMsgId)"
                    @cancel="cancelUploadByClientId(message.clientMsgId)"
                  />
                  <template v-else-if="message.msgType === 3 && message.fileUrl">
                    <a :href="message.fileUrl ?? undefined" target="_blank" download class="file-link">
                      📎 {{ message.fileName }}
                      <small>{{ fmtSize(message.fileSize!) }}</small>
                    </a>
                  </template>
                  <template v-else-if="isPendingMediaMessage(message)">
                    <div class="media-fallback">
                      <span>{{ pendingMediaText(message) }}</span>
                      <small v-if="message.msgType === 3 && message.fileSize">{{ fmtSize(message.fileSize) }}</small>
                    </div>
                  </template>
                </div>
                <div v-if="shouldShowMessageStatus(index) && !hasInlineMediaStatus(message)" class="read-tag">
                  <MessageStatusIndicator
                    :status="message.localStatus"
                    :is-read="message.isRead === 1"
                    :progress="message.uploadProgress"
                    :error="message.localError"
                    :show-read-state="!message.localStatus && isLastSelfMessage(index)"
                    @retry="retryMessageByClientId(message.clientMsgId)"
                    @cancel="cancelUploadByClientId(message.clientMsgId)"
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
          <ReplyComposerBar
            v-if="replyingTo"
            :message="replyingTo"
            :sender-name="replySenderName(replyingTo.senderId)"
            @cancel="clearReply"
          />
          <div class="input-row">
            <button class="ibtn tap-target" :class="{ on: emojiOpen }" type="button" @click="emojiOpen = !emojiOpen">😊</button>
            <VoiceRecorderButton
              compact
              @recording-start="emojiOpen = false"
              @recorded="onVoiceRecorded"
              @warning="ElMessage.warning($event)"
            />
            <button class="ibtn tap-target" type="button" @click="fileEl?.click()">＋</button>
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

    <IncomingCallOverlay
      v-if="callStore.phase === 'incoming'"
      :peer-name="callStore.peerName"
      @accept="callStore.acceptCall"
      @reject="callStore.rejectCall"
    />

    <VoiceCallOverlay
      v-if="callStore.phase !== 'idle' && callStore.phase !== 'incoming'"
      :phase="callStore.phase"
      :peer-name="callStore.peerName"
      :duration-seconds="callStore.durationSeconds"
      :muted="callStore.muted"
      :error="callStore.error"
      :remote-stream="callStore.remoteStream"
      @hangup="endCurrentCall"
      @toggle-mute="callStore.toggleMute"
    />

    <MediaPreview
      :visible="previewVisible"
      :url="previewUrl"
      :type="previewType"
      :poster-url="previewPosterUrl"
      @close="previewVisible = false"
    />

    <AttachmentSendDialog
      :visible="!!attachmentComposer.staged.value"
      :files="attachmentComposer.staged.value?.files ?? []"
      :recipient-name="attachmentComposer.staged.value?.recipient.nickname ?? ''"
      @cancel="attachmentComposer.cancel"
      @confirm="confirmAttachment"
    />

    <AvailabilityDialog
      :visible="availabilityVisible"
      @close="availabilityVisible = false"
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
import { useCallStore } from '../stores/call'
import { useUserStore } from '../stores/user'
import { useChatScroll } from '../composables/useChatScroll'
import { useChatComposer } from '../composables/useChatComposer'
import { useChatAttachments } from '../composables/useChatAttachments'
import { useChatMessageUi } from '../composables/useChatMessageUi'
import { formatChatTime as fmtChatTime, formatFileSize as fmtSize } from '../utils/time'
import { formatContactPresence } from '../utils/availability'
import { getMessageActions, type MessageAction } from '../utils/messageActions'
import { isIOSDevice } from '../utils/platform'
import ContactList from '../components/ContactList.vue'
import ConnectionNotice from '../components/ConnectionNotice.vue'
import ConversationMessageState from '../components/ConversationMessageState.vue'
import MediaPreview from '../components/MediaPreview.vue'
import MediaMessageCard from '../components/MediaMessageCard.vue'
import VoiceRecorderButton from '../components/VoiceRecorderButton.vue'
import MessageStatusIndicator from '../components/MessageStatusIndicator.vue'
import NewMessageButton from '../components/NewMessageButton.vue'
import AttachmentSendDialog from '../components/AttachmentSendDialog.vue'
import MessageActionMenu from '../components/MessageActionMenu.vue'
import MessageReplyQuote from '../components/MessageReplyQuote.vue'
import ReplyComposerBar from '../components/ReplyComposerBar.vue'
import AvailabilityDialog from '../components/AvailabilityDialog.vue'
import VoiceCallButton from '../components/VoiceCallButton.vue'
import VoiceCallOverlay from '../components/VoiceCallOverlay.vue'
import IncomingCallOverlay from '../components/IncomingCallOverlay.vue'
import type { Message } from '../types'

const chatStore = useChatStore()
const callStore = useCallStore()
const userStore = useUserStore()
const router = useRouter()
const uid = computed(() => userStore.userId)

const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const emojiOpen = ref(false)
const previewVisible = ref(false)
const previewUrl = ref('')
const previewType = ref<'image' | 'video'>('image')
const previewPosterUrl = ref('')
const dragActive = ref(false)
const availabilityVisible = ref(false)
const isIOS = isIOSDevice()

const actionMenuVisible = ref(false)
const actionMenuActions = ref<MessageAction[]>([])
const actionMenuX = ref(0)
const actionMenuY = ref(0)
const actionMessage = ref<Message | null>(null)
const replyingTo = ref<Message | null>(null)
let selectionSeq = 0
let dragDepth = 0

const scroll = useChatScroll(listEl, uid, { virtualized: false })
const composer = useChatComposer({
  inputEl,
  emojiOpen,
  maxHeight: 100,
  scroll,
  getReplyTo: () => replyingTo.value,
  onReplySent: clearReply,
})
const { drafts, text, grow, addEmoji, send } = composer
const attachments = useChatAttachments({
  emojiOpen,
  scroll,
  onWarning: (message) => ElMessage.warning(message),
  getReplyTo: () => replyingTo.value,
  onReplySent: clearReply,
})
const { attachmentComposer, attachmentIngress } = attachments
const {
  showTimeByIndex,
  isLastSelfMessage,
  shouldShowMessageStatus,
  isPendingMediaMessage,
  isRichMediaMessage,
  isStandaloneVisualMedia,
  isStandaloneVoiceMessage,
  hasInlineMediaStatus,
  pendingMediaText,
  bubbleType,
  videoPosterUrl,
} = useChatMessageUi(uid)

onMounted(async () => {
  callStore.ensureBound()
  void callStore.checkAvailability()
  await chatStore.loadContacts()
  chatStore.connectWs()
})

onUnmounted(() => {
  stopCallBeforeLogout()
  dragActive.value = false
  dragDepth = 0
})

watch(() => chatStore.currentContact?.userId, () => {
  closeMessageMenu()
  clearReply()
  nextTick(grow)
})
watch(listEl, (el) => { scroll.onListReady(el) })
watch(() => chatStore.messages.length, () => { scroll.onMessagesChange() })
watch(() => chatStore.messages, closeMessageMenu)

async function pickContact(id: number) {
  const seq = ++selectionSeq
  await chatStore.selectContact(id)
  if (seq !== selectionSeq || chatStore.currentContact?.userId !== id) return

  await nextTick()
  if (seq !== selectionSeq) return
  scroll.onContactChange({ scrollToBottom: true })
}

async function retryInitialMessages() {
  const loaded = await chatStore.retryInitialMessages()
  if (loaded) scroll.scrollToBottomAndClear(false)
}

function openPreview(url: string, type: 'image' | 'video', posterUrl = '') {
  previewUrl.value = url
  previewType.value = type
  previewPosterUrl.value = type === 'video' ? posterUrl : ''
  previewVisible.value = true
}

function openMediaFromBubble(
  _event: MouseEvent,
  type: 'image' | 'video',
  url: string,
  posterUrl = '',
) {
  openPreview(url, type, posterUrl)
}

function startCurrentCall() {
  if (chatStore.currentContact) void callStore.startCall(chatStore.currentContact)
}

function endCurrentCall() {
  if (callStore.phase === 'preparing' || callStore.phase === 'outgoing') callStore.cancelCall()
  else callStore.hangup()
}

function stopCallBeforeLogout() {
  if (callStore.phase === 'incoming') callStore.rejectCall()
  else if (callStore.phase === 'preparing' || callStore.phase === 'outgoing') callStore.cancelCall()
  else if (callStore.phase === 'connecting' || callStore.phase === 'connected') callStore.hangup()
  callStore.dispose()
}

function logout() {
  stopCallBeforeLogout()
  drafts.clearAll()
  attachmentComposer.cancel()
  closeMessageMenu()
  clearReply()
  chatStore.disconnectWs()
  userStore.logout()
  chatStore.clearState()
  router.replace('/')
}

function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = ''
  if (files.length === 0) return
  attachmentIngress.acceptFiles(files)
}

async function onVoiceRecorded(file: File) {
  await attachments.uploadFiles([file])
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
  await attachments.uploadConfirmed()
}

function retryMessageByClientId(clientMsgId?: string) {
  if (!clientMsgId) return
  chatStore.retryMessage(clientMsgId)
  scroll.scrollToBottomAndClear(true)
}

function cancelUploadByClientId(clientMsgId?: string) {
  if (!clientMsgId) return
  chatStore.cancelUpload(clientMsgId)
}

function replySenderName(senderId: number) {
  return senderId === uid.value ? '我' : chatStore.currentContact?.nickname || '对方'
}

function clearReply() {
  replyingTo.value = null
}

function startReply(message: Message) {
  if (message.id <= 0) return
  replyingTo.value = message
  emojiOpen.value = false
  nextTick(() => inputEl.value?.focus())
}

async function jumpToReply(messageId: number) {
  if (!await scroll.locateMessage(messageId)) {
    ElMessage.warning('原消息暂时无法定位')
  }
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

  if (action === 'reply') {
    startReply(message)
    return
  }
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
    openPreview(
      message.fileUrl,
      message.msgType === 2 ? 'image' : 'video',
      message.msgType === 5 ? videoPosterUrl(message) : '',
    )
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
.desktop-call-button { margin-left: auto; }
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
.bubble { position: relative; max-width: 65%; padding: 9px 13px; border-radius: 12px; font-size: 15px; line-height: 1.5; word-break: break-word; }
.message-item.reply-highlight .bubble { animation: replyTargetFlash 1.35s ease; }
@keyframes replyTargetFlash { 0%, 100% { box-shadow: none; } 20%, 70% { box-shadow: 0 0 0 3px rgba(7,193,96,0.32); } }
.bubble.mine { background: #95ec69; color: #111; border-bottom-right-radius: 3px; }
.bubble.his { background: #fff; color: #111; border-bottom-left-radius: 3px; }
.bubble.emoji { background: transparent; padding: 2px 4px; }
.bubble.visual-media { max-width: none; padding: 0; background: transparent; box-shadow: none; }
.bubble.voice-media { padding-top: 0; padding-bottom: 0; padding-left: 11px; padding-right: 11px; }
.message-text { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; }
.emoji-big { font-size: 52px; line-height: 1.2; }
.file-link { color: #576b95; font-size: 14px; text-decoration: none; display: block; }
.file-link small { display: block; color: #999; font-size: 12px; }
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
