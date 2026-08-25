<template>
  <div class="mobile-root">
    <div v-if="!chatting" class="contact-page">
      <ContactList
        :contacts="chatStore.sortedContacts"
        :current-id="null"
        :ws-connected="chatStore.wsConnected"
        @select="openChat"
        @logout="logout"
      />
    </div>

    <div v-else class="chat-page" :style="chatPageStyle">
      <div class="chat-head">
        <button class="back tap-target" type="button" aria-label="返回消息列表" @click="requestBack">‹</button>
        <div class="ch-info">
          <div class="ch-name">{{ chatStore.currentContact?.nickname }}</div>
          <div class="ch-status">{{ chatStore.currentContact?.online ? '在线' : formatLastSeen(chatStore.currentContact?.lastSeenAt ?? null) }}</div>
        </div>
        <div class="chat-head-spacer" aria-hidden="true"></div>
      </div>

      <ConnectionNotice
        :status="chatStore.wsStatus"
        :recovered-notice="chatStore.recoveredNotice"
        :pending-count="chatStore.pendingChatCount"
        @reconnect="chatStore.reconnectNow"
      />

      <div ref="listEl" class="msg-scroll" @click="collapseInput">
        <div class="load-more">
          <template v-if="scroll.loading.value">
            <span class="spinner"></span>
            <span class="load-text">加载历史消息...</span>
          </template>
          <button
            v-else-if="scroll.loadMoreError.value"
            type="button"
            class="load-retry tap-target"
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
              @pointerdown="longPress.start($event, chatStore.messages[vi.index])"
              @pointermove="longPress.move($event)"
              @pointerup="longPress.cancel"
              @pointercancel="longPress.cancel"
              @contextmenu="onMobileContextMenu($event, chatStore.messages[vi.index])"
            >
              <div class="bubble" :class="bubbleType(chatStore.messages[vi.index])">
                <template v-if="chatStore.messages[vi.index].msgType === 1">{{ chatStore.messages[vi.index].content }}</template>
                <template v-else-if="chatStore.messages[vi.index].msgType === 4"><span class="emoji-big">{{ chatStore.messages[vi.index].content }}</span></template>
                <template v-else-if="chatStore.messages[vi.index].msgType === 2 && chatStore.messages[vi.index].fileUrl">
                  <img
                    :src="chatStore.messages[vi.index].fileId ? `/api/files/${chatStore.messages[vi.index].fileId}/thumbnail` : chatStore.messages[vi.index].fileUrl ?? undefined"
                    decoding="async"
                    class="pic"
                    @error="fallbackImageToOriginal($event, chatStore.messages[vi.index])"
                    @click.stop="openPreviewFromBubble($event, chatStore.messages[vi.index].fileUrl!, 'image')"
                  />
                </template>
                <template v-else-if="chatStore.messages[vi.index].msgType === 5 && chatStore.messages[vi.index].fileUrl">
                  <a
                    :href="chatStore.messages[vi.index].fileUrl ?? undefined"
                    :target="isIOS ? '_self' : '_blank'"
                    rel="noopener"
                    class="video-link"
                    @click.stop="guardNativeMessageClick"
                  >
                    {{ chatStore.messages[vi.index].fileName }}
                    <small v-if="chatStore.messages[vi.index].fileSize">{{ fmtSize(chatStore.messages[vi.index].fileSize!) }}</small>
                  </a>
                </template>
                <template v-else-if="chatStore.messages[vi.index].msgType === 3 && chatStore.messages[vi.index].fileUrl">
                  <a
                    :href="chatStore.messages[vi.index].fileUrl ?? undefined"
                    :target="isIOS ? '_self' : '_blank'"
                    :download="isIOS ? undefined : ''"
                    class="file-link"
                    @click.stop="guardNativeMessageClick"
                  >
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
        class="new-message-entry"
        :visible="scroll.showBottomButton.value"
        :count="scroll.newMessageCount.value"
        @click="scroll.scrollToBottomAndClear(true)"
      />

      <MediaPreview
        :visible="previewVisible"
        :url="previewUrl"
        :type="previewType"
        @close="closeOverlay('media')"
      />

      <div v-if="emojiOpen" class="emoji-box">
        <div class="emoji-head">
          <span>表情</span>
          <button class="tap-target" type="button" aria-label="关闭表情面板" @click="closeOverlay('emoji')">✕</button>
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
          <button class="ibtn tap-target" :class="{ on: emojiOpen }" type="button" aria-label="表情" @click="toggleEmoji">😊</button>
          <button class="ibtn tap-target" type="button" aria-label="添加附件" :disabled="uploadBusy" @click="fileEl?.click()">＋</button>
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
          <button class="sbtn tap-target" :class="{ ready: text.trim() }" type="button" :disabled="!text.trim()" @click="send">发送</button>
        </div>
      </div>

      <AttachmentSendDialog
        :visible="!!attachmentComposer.staged.value"
        :file="attachmentComposer.staged.value?.file ?? null"
        :recipient-name="attachmentComposer.staged.value?.recipient.nickname ?? ''"
        :busy="uploadBusy"
        @cancel="closeOverlay('attachment')"
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
import { useMobileChatHistory, type MobileChatUiState, type MobileOverlayKind } from '../composables/useMobileChatHistory'
import { useLongPress } from '../composables/useLongPress'
import { formatChatTime as fmtChatTime, formatLastSeen, shouldShowTimeSeparator, formatFileSize as fmtSize } from '../utils/time'
import { getMessageActions, type MessageAction } from '../utils/messageActions'
import ContactList from '../components/ContactList.vue'
import MediaPreview from '../components/MediaPreview.vue'
import ConnectionNotice from '../components/ConnectionNotice.vue'
import ConversationMessageState from '../components/ConversationMessageState.vue'
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
const mobileHistory = useMobileChatHistory(router)

const chatting = ref(false)
const listEl = ref<HTMLElement | null>(null)
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileEl = ref<HTMLInputElement | null>(null)
const emojiOpen = ref(false)
const progress = ref(0)
const uploadBusy = ref(false)
const inputFocused = ref(false)
const viewportHeight = ref(0)
const viewportTop = ref(0)
const previewVisible = ref(false)
const previewUrl = ref('')
const previewType = ref<'image' | 'video'>('image')

const actionMenuVisible = ref(false)
const actionMenuActions = ref<MessageAction[]>([])
const actionMenuX = ref(0)
const actionMenuY = ref(0)
const actionMessage = ref<Message | null>(null)

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
  getRecipient: currentRecipient,
  onStage: (file, recipient) => {
    emojiOpen.value = false
    attachmentComposer.stage(file, recipient)
  },
  onWarning: (message) => ElMessage.warning(message),
})

const scroll = useChatScroll(listEl, uid)
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
const chatPageStyle = computed(() => viewportHeight.value ? {
  height: `${viewportHeight.value}px`,
  transform: `translateY(${viewportTop.value}px)`,
} : undefined)

let vvHandler: (() => void) | null = null
let unsubscribeHistory: (() => void) | null = null
let pinnedEndFrame: number | null = null
let focusStartedAtEnd = false
let historySyncSeq = 0
let historyBackPending = false
let suppressNativeClickUntil = 0

const longPress = useLongPress<Message>((message, event) => {
  suppressNativeClickUntil = Date.now() + 600
  openMessageMenuAt(event.clientX, event.clientY, message)
})

onMounted(async () => {
  installViewportHandler()
  await chatStore.loadContacts()
  chatStore.connectWs()
  await mobileHistory.replaceList()
  unsubscribeHistory = mobileHistory.subscribe((state) => {
    historyBackPending = false
    void applyHistoryState(state)
  })
})

onUnmounted(() => {
  historySyncSeq += 1
  unsubscribeHistory?.()
  longPress.cancel()
  drafts.clearAll()
  scrollMemory.clearAll()
  if (vvHandler && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', vvHandler)
    window.visualViewport.removeEventListener('scroll', vvHandler)
  }
  cancelPinnedEndSync()
  chatStore.clearState()
})

function cancelPinnedEndSync() {
  if (pinnedEndFrame === null) return
  cancelAnimationFrame(pinnedEndFrame)
  pinnedEndFrame = null
}

function schedulePinnedEndSync() {
  cancelPinnedEndSync()
  const expectedHeight = viewportHeight.value

  pinnedEndFrame = requestAnimationFrame(() => {
    pinnedEndFrame = requestAnimationFrame(() => {
      pinnedEndFrame = null
      if (!inputFocused.value || !focusStartedAtEnd) return
      if (Math.abs(viewportHeight.value - expectedHeight) > 0.5) {
        schedulePinnedEndSync()
        return
      }
      scroll.scrollToBottom(false)
    })
  })
}

function updateViewport() {
  const vv = window.visualViewport
  const nextHeight = vv?.height || window.innerHeight
  const heightChanged = Math.abs(nextHeight - viewportHeight.value) > 0.5
  viewportHeight.value = nextHeight
  viewportTop.value = vv ? Math.max(0, vv.pageTop) : 0
  if (heightChanged && inputFocused.value && focusStartedAtEnd) schedulePinnedEndSync()
}

function installViewportHandler() {
  updateViewport()
  if (!window.visualViewport || vvHandler) return
  vvHandler = updateViewport
  window.visualViewport.addEventListener('resize', vvHandler)
  window.visualViewport.addEventListener('scroll', vvHandler)
}

function requestBack() {
  if (historyBackPending) return
  historyBackPending = true
  mobileHistory.back()
}

function rememberCurrentScroll() {
  const contactId = chatStore.currentContact?.userId
  if (contactId) scrollMemory.remember(contactId, scroll.captureVisibleAnchor())
}

async function restoreContactScroll(contactId: number) {
  await nextTick()
  scroll.onContactChange({ scrollToBottom: false })
  const anchor = scrollMemory.get(contactId)
  const restored = anchor ? await scroll.restoreVisibleAnchor(anchor) : false
  if (!restored) scroll.scrollToBottomAndClear(false)
  grow()
}

async function openChat(id: number) {
  const seq = ++historySyncSeq
  await chatStore.selectContact(id)
  if (seq !== historySyncSeq) return
  chatting.value = true
  await restoreContactScroll(id)
  await mobileHistory.pushChat(id)
}

async function ensureChat(contactId: number, seq: number) {
  const previousId = chatStore.currentContact?.userId
  const contactChanged = previousId !== contactId
  if (contactChanged) {
    if (previousId) scrollMemory.remember(previousId, scroll.captureVisibleAnchor())
    await chatStore.selectContact(contactId)
    if (seq !== historySyncSeq) return false
  }
  chatting.value = true
  if (contactChanged) await restoreContactScroll(contactId)
  else {
    await nextTick()
    grow()
  }
  return seq === historySyncSeq
}

async function applyHistoryState(state: MobileChatUiState) {
  const seq = ++historySyncSeq
  closeMessageMenu()
  longPress.cancel()

  if (state.kind === 'list') {
    rememberCurrentScroll()
    emojiOpen.value = false
    previewVisible.value = false
    attachmentComposer.cancel()
    chatting.value = false
    chatStore.currentContact = null
    chatStore.messages = []
    return
  }

  if (!await ensureChat(state.contactId, seq)) return

  if (state.kind === 'chat') {
    emojiOpen.value = false
    previewVisible.value = false
    attachmentComposer.cancel()
    return
  }

  if (state.overlay === 'media') {
    emojiOpen.value = false
    attachmentComposer.cancel()
    if (!previewUrl.value) {
      previewVisible.value = false
      await mobileHistory.replaceChat(state.contactId)
      return
    }
    previewVisible.value = true
    return
  }

  if (state.overlay === 'emoji') {
    previewVisible.value = false
    attachmentComposer.cancel()
    emojiOpen.value = true
    inputEl.value?.blur()
    inputFocused.value = false
    return
  }
  previewVisible.value = false
  emojiOpen.value = false
  if (!attachmentComposer.staged.value) await mobileHistory.replaceChat(state.contactId)
}

watch(() => chatStore.currentContact?.userId, () => {
  closeMessageMenu()
  nextTick(grow)
})
watch(() => chatStore.messages.length, () => { scroll.onMessagesChange() })
watch(() => chatStore.messages, closeMessageMenu)

async function retryInitialMessages() {
  const loaded = await chatStore.retryInitialMessages()
  if (loaded) scroll.scrollToBottomAndClear(false)
}

async function send() {
  const contactId = chatStore.currentContact?.userId
  const value = text.value.trim()
  if (!contactId || !value) return
  if (emojiOpen.value) closeOverlay('emoji')
  const isEmoji = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]$/u.test(value)
  chatStore.sendMessage(value, isEmoji ? 4 : 1)
  drafts.clear(contactId)
  await nextTick()
  if (inputEl.value) inputEl.value.style.height = 'auto'
  scroll.scrollToBottomAndClear(true)
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploadBusy.value) return
  const contactId = chatStore.currentContact?.userId
  if (!contactId || !attachmentIngress.acceptFiles([file])) return
  await mobileHistory.pushOverlay(contactId, 'attachment')
}

async function confirmAttachment() {
  const file = attachmentComposer.takeConfirmed()
  if (!file || uploadBusy.value) return
  const state = mobileHistory.read()
  if (state.kind === 'overlay' && state.overlay === 'attachment') requestBack()
  uploadBusy.value = true
  try {
    await doUpload(file)
  } finally {
    uploadBusy.value = false
  }
}

async function doUpload(file: File) {
  progress.value = 0
  try {
    await chatStore.sendFile(file, p => { progress.value = p })
    await nextTick()
    scroll.scrollToBottomAndClear(true)
  } finally {
    progress.value = 0
  }
}

function addEmoji(emoji: string) {
  text.value += emoji
  inputEl.value?.focus()
  nextTick(grow)
}

async function toggleEmoji() {
  const contactId = chatStore.currentContact?.userId
  if (!contactId) return
  if (emojiOpen.value) {
    closeOverlay('emoji')
    return
  }

  const keepAtEnd = scroll.isNearBottom(160)
  emojiOpen.value = true
  inputEl.value?.blur()
  inputFocused.value = false
  await mobileHistory.pushOverlay(contactId, 'emoji')
  await nextTick()
  grow()
  if (keepAtEnd) scroll.scrollToBottom(false)
}

function closeOverlay(kind: MobileOverlayKind) {
  const state = mobileHistory.read()
  if (state.kind === 'overlay' && state.overlay === kind) {
    requestBack()
    return
  }
  if (kind === 'media') previewVisible.value = false
  if (kind === 'emoji') emojiOpen.value = false
  if (kind === 'attachment') attachmentComposer.cancel()
}

function grow() {
  if (!inputEl.value) return
  inputEl.value.style.height = 'auto'
  const borderHeight = inputEl.value.offsetHeight - inputEl.value.clientHeight
  const contentHeight = inputEl.value.scrollHeight + borderHeight
  inputEl.value.style.height = Math.min(contentHeight, 108) + 'px'
  inputEl.value.style.overflowY = contentHeight > 108 ? 'auto' : 'hidden'
}

function onFocus() {
  focusStartedAtEnd = scroll.isNearBottom(120)
  inputFocused.value = true
  if (emojiOpen.value) closeOverlay('emoji')
  updateViewport()
}

function onBlur() {
  inputFocused.value = false
  focusStartedAtEnd = false
  cancelPinnedEndSync()
  updateViewport()
}

function collapseInput() {
  if (emojiOpen.value) closeOverlay('emoji')
  inputEl.value?.blur()
  inputFocused.value = false
  focusStartedAtEnd = false
  cancelPinnedEndSync()
}

function showTimeByIndex(i: number) {
  if (i === 0) return true
  return shouldShowTimeSeparator(chatStore.messages[i].createdAt, chatStore.messages[i - 1].createdAt)
}

function isLastSelfMessage(index: number) {
  const message = chatStore.messages[index]
  if (!message || message.senderId !== uid.value) return false
  return !chatStore.messages.slice(index + 1).some(m => m.senderId === uid.value)
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

function retryMessageByClientId(clientMsgId?: string) {
  if (!clientMsgId) return
  chatStore.retryMessage(clientMsgId)
  scroll.scrollToBottomAndClear(true)
}

function bubbleType(message: { msgType: number; senderId: number }) {
  if (message.msgType === 4) return 'emoji'
  return message.senderId === uid.value ? 'mine' : 'his'
}

function fallbackImageToOriginal(event: Event, message: Message) {
  const image = event.currentTarget
  if (!(image instanceof HTMLImageElement) || !message.fileId || !message.fileUrl) return
  if (image.dataset.originalFallback === '1') return
  image.dataset.originalFallback = '1'
  image.src = message.fileUrl
}

function guardNativeMessageClick(event: MouseEvent) {
  if (Date.now() >= suppressNativeClickUntil) return
  suppressNativeClickUntil = 0
  event.preventDefault()
  event.stopPropagation()
}

function openPreviewFromBubble(event: MouseEvent, url: string, type: 'image' | 'video') {
  if (Date.now() < suppressNativeClickUntil) {
    suppressNativeClickUntil = 0
    event.preventDefault()
    event.stopPropagation()
    return
  }
  void openPreview(url, type)
}

async function openPreview(url: string, type: 'image' | 'video') {
  const contactId = chatStore.currentContact?.userId
  if (!contactId) return
  emojiOpen.value = false
  previewUrl.value = url
  previewType.value = type
  previewVisible.value = true
  await mobileHistory.pushOverlay(contactId, 'media')
}

function onMobileContextMenu(event: MouseEvent, message: Message) {
  const actions = getMessageActions(message)
  if (actions.length === 0) return
  event.preventDefault()
  suppressNativeClickUntil = Date.now() + 600
  openMessageMenuAt(event.clientX, event.clientY, message)
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
    await openPreview(message.fileUrl, message.msgType === 2 ? 'image' : 'video')
    return
  }
  if (action === 'open' && message.fileUrl) {
    if (isIOS) window.location.assign(message.fileUrl)
    else window.open(message.fileUrl, '_blank', 'noopener,noreferrer')
    return
  }
  if (action === 'save' && message.fileUrl) {
    if (isIOS) {
      window.location.assign(message.fileUrl)
      return
    }
    const anchor = document.createElement('a')
    anchor.href = message.fileUrl
    anchor.download = message.fileName || 'download'
    anchor.rel = 'noopener'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }
}

function logout() {
  historySyncSeq += 1
  drafts.clearAll()
  scrollMemory.clearAll()
  attachmentComposer.cancel()
  closeMessageMenu()
  chatStore.disconnectWs()
  userStore.logout()
  chatStore.clearState()
  router.replace('/')
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
html, body, #app { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; position: fixed; -webkit-text-size-adjust: 100%; }
</style>

<style scoped>
.mobile-root { width: 100%; height: 100%; overflow: hidden; }
.contact-page { height: 100%; }
.chat-page { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; overflow: hidden; background: #ededed; }
.chat-head { display: grid; grid-template-columns: 44px minmax(0, 1fr) 44px; align-items: center; padding: 6px 16px; background: rgba(255,255,255,0.96); border-bottom: 1px solid rgba(0,0,0,0.08); flex-shrink: 0; padding-top: calc(6px + env(safe-area-inset-top)); min-height: 56px; backdrop-filter: saturate(180%) blur(20px); -webkit-backdrop-filter: saturate(180%) blur(20px); }
.back { width: 44px; height: 44px; justify-self: start; font-size: 32px; line-height: 1; color: #1c1c1e; background: none; border: none; cursor: pointer; padding: 0; font-weight: 300; -webkit-tap-highlight-color: transparent; border-radius: 22px; touch-action: manipulation; }
.back:active { background: #f2f2f7; }
.ch-info { min-width: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; line-height: 1.15; }
.ch-name { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 16px; font-weight: 600; color: #111; }
.ch-status { margin-top: 3px; font-size: 11px; color: #8e8e93; }
.chat-head-spacer { width: 44px; height: 44px; }
:deep(.connection-notice) { margin: 8px 12px 0; flex-shrink: 0; }
.msg-scroll { flex: 1; overflow-y: auto; min-height: 0; -webkit-overflow-scrolling: touch; padding: 12px; background: #ededed; touch-action: pan-y; }
.load-more { text-align: center; height: 44px; padding: 0 8px; box-sizing: border-box; display: flex; align-items: center; justify-content: center; gap: 8px; }
.load-text { font-size: 12px; color: #999; }
.load-retry { min-height: 44px; padding: 0 8px; border: 0; background: transparent; color: #576b95; font-size: 12px; cursor: pointer; }
.spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #ddd; border-top-color: #07c160; border-radius: 50%; animation: spin 0.6s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
.time-bar { text-align: center; padding: 6px 0 8px; }
.time-bar span { font-size: 11px; color: #a6a6aa; background: transparent; padding: 0 6px; border-radius: 0; }
.msg { display: flex; flex-direction: column; padding-bottom: 6px; touch-action: pan-y; -webkit-touch-callout: none; }
.msg.right { align-items: flex-end; }
.msg.left { align-items: flex-start; }
.bubble { max-width: 78%; padding: 9px 12px; border-radius: 18px; font-size: 16px; line-height: 1.45; word-break: break-word; overflow-wrap: anywhere; }
.bubble.mine { background: #95ec69; color: #111; border-bottom-right-radius: 6px; }
.bubble.his { background: #fff; color: #111; border-bottom-left-radius: 6px; box-shadow: 0 1px 0 rgba(0,0,0,0.04); }
.bubble.emoji { background: transparent; padding: 2px 4px; box-shadow: none; }
.emoji-big { font-size: 52px; line-height: 1.2; }
.pic { max-width: min(68vw, 240px); max-height: min(42dvh, 320px); border-radius: 12px; display: block; cursor: pointer; }
.video-link, .file-link { color: #576b95; font-size: 14px; text-decoration: none; display: block; }
.video-link small, .file-link small { display: block; color: #999; font-size: 12px; }
.media-fallback { min-width: 120px; padding: 10px 12px; border-radius: 12px; background: rgba(255,255,255,0.45); color: #576b95; font-size: 14px; }
.media-fallback small { display: block; margin-top: 2px; color: #999; font-size: 12px; }
.read-tag { margin-top: 2px; padding-right: 4px; }
.new-message-entry { position: absolute; right: 16px; bottom: calc(70px + env(safe-area-inset-bottom)); z-index: 20; }
.empty-tip { display: flex; align-items: center; justify-content: center; height: 100%; color: #999; font-size: 14px; }
.emoji-box { background: #f7f7f8; border-top: 1px solid rgba(0,0,0,0.08); flex-shrink: 0; height: min(36dvh, 300px); max-height: 300px; min-height: 190px; animation: slideUp .18s ease-out; }
@keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.emoji-head { display: flex; justify-content: space-between; align-items: center; height: 44px; padding: 0 16px; font-size: 13px; color: #8e8e93; border-bottom: 1px solid rgba(0,0,0,0.06); }
.emoji-head button { background: none; border: none; color: #8e8e93; font-size: 16px; cursor: pointer; border-radius: 22px; touch-action: manipulation; }
.emoji-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(44px, 1fr)); gap: 2px; padding: 8px; height: calc(100% - 44px); max-height: none; overflow-y: auto; -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; }
.emoji-list button { width: 100%; min-width: 44px; min-height: 44px; aspect-ratio: 1; font-size: 25px; background: none; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; -webkit-tap-highlight-color: transparent; border-radius: 12px; touch-action: manipulation; }
.emoji-list button:active { background: #e9e9ee; }
.input-bar { background: rgba(250,250,250,0.98); border-top: 1px solid rgba(0,0,0,0.08); flex-shrink: 0; padding-bottom: env(safe-area-inset-bottom); transition: transform 0.16s ease; }
.prog { padding: 0 16px; height: 3px; }
.prog-fill { height: 100%; background: #07c160; transition: width 0.2s; }
.input-row { display: flex; align-items: flex-end; gap: 6px; padding: 7px 10px; }
.ibtn { width: 44px; height: 44px; flex-shrink: 0; background: transparent; border: none; font-size: 22px; cursor: pointer; display: flex; align-items: center; justify-content: center; -webkit-tap-highlight-color: transparent; border-radius: 22px; touch-action: manipulation; color: #1c1c1e; }
.ibtn:active, .ibtn.on { background: #e9e9ee; }
.ibtn:disabled { cursor: not-allowed; opacity: 0.45; }
.txt { flex: 1; border: 1px solid rgba(60,60,67,0.18); border-radius: 22px; padding: 10px 14px; font-size: 16px; background: #fff; resize: none; outline: none; line-height: 1.35; max-height: 108px; min-height: 44px; overflow-y: auto; -webkit-appearance: none; }
.txt:focus { border-color: rgba(60,60,67,0.26); box-shadow: 0 0 0 1px rgba(60,60,67,0.08); }
.sbtn { width: auto; min-width: 58px; height: 44px; padding: 0 16px; flex-shrink: 0; background: #b8e8c8; color: #fff; border: none; border-radius: 22px; font-size: 15px; font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.sbtn.ready { background: #07c160; }
.sbtn:disabled { background: #e5e5ea; color: #aeaeb2; }
.sbtn.ready:not(:disabled):active { background: #06ad56; transform: scale(0.98); }
</style>