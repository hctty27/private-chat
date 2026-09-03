import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Contact, LocalMessageStatus, Message, MessageLoadState, WsClientChat, WsClientMessage, WsServerMessage } from '../types'
import { getContacts, getMessages, uploadFile } from '../api'
import { forceLogout } from '../auth/session'
import { useUserStore } from './user'
import { belongsToConversation, chatPayloadFromMessage, createClientMsgId, createLocalMessage } from '../utils/chatLocal'
import { getAttachmentRecipientId } from '../utils/attachmentRecipient'
import { isDocumentVisible, shouldIncrementUnread } from '../utils/chatVisibility'
import { chatUploadQueue } from '../utils/uploadQueue'

const CONVERSATION_CACHE_LIMIT = 5

type ConversationCacheEntry = {
  messages: Message[]
  hasMore: boolean
  cursor: string
}

export const useChatStore = defineStore('chat', () => {
  const contacts = ref<Contact[]>([])
  const currentContact = ref<Contact | null>(null)
  const messages = ref<Message[]>([])
  const hasMore = ref(false)
  const messageCursor = ref('')
  const messageLoadState = ref<MessageLoadState>('idle')
  const messageLoadError = ref('')
  const ws = ref<WebSocket | null>(null)
  const wsConnected = ref(false)
  // connected | disconnected | reconnecting
  const wsStatus = ref<'connected' | 'disconnected' | 'reconnecting'>('disconnected')
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let connectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let intentionalClose = false
  let reconnecting = false
  const pendingMessages: WsClientChat[] = []
  const sendTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingLocalMessages = new Map<string, Message>()
  const sentClientMsgIds = new Set<string>()
  const sentClientMsgTimes = new Map<string, number>()
  const conversationCache = new Map<number, ConversationCacheEntry>()
  const recoveredNotice = ref(false)
  let storeGeneration = 0
  let initLoadSeq = 0
  let loadMoreSeq = 0
  let recoverySeq = 0
  let cacheRefreshSeq = 0
  let recoveringMessages = false
  let recoveredNoticeTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectCheckTimer: ReturnType<typeof setTimeout> | null = null
  const wsMessageListeners = new Set<(message: WsServerMessage) => void>()

  function onWsMessage(listener: (message: WsServerMessage) => void) {
    wsMessageListeners.add(listener)
    return () => {
      wsMessageListeners.delete(listener)
    }
  }

  function notifyWsMessage(message: WsServerMessage) {
    for (const listener of wsMessageListeners) {
      try {
        listener(message)
      } catch (error) {
        console.error('WebSocket listener failed', error)
      }
    }
  }

  const sortedContacts = computed(() =>
    [...contacts.value].sort((a, b) => {
      if (!a.lastMessageTime) return 1
      if (!b.lastMessageTime) return -1
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
    })
  )

  const pendingChatCount = computed(() =>
    messages.value.filter((m) =>
      m.localStatus === 'queued' ||
      m.localStatus === 'sending' ||
      m.localStatus === 'upload_queued' ||
      m.localStatus === 'uploading'
    ).length
  )

  function setConversationCache(targetId: number, entry: ConversationCacheEntry) {
    conversationCache.delete(targetId)
    conversationCache.set(targetId, entry)

    while (conversationCache.size > CONVERSATION_CACHE_LIMIT) {
      const oldest = conversationCache.keys().next().value
      if (oldest === undefined) break
      conversationCache.delete(oldest)
    }
  }

  function saveCurrentConversationToCache() {
    const targetId = currentContact.value?.userId
    if (!targetId) return
    if (messageLoadState.value !== 'loaded' && messages.value.length === 0) return

    setConversationCache(targetId, {
      messages: messages.value,
      hasMore: hasMore.value,
      cursor: messageCursor.value,
    })
  }

  function restoreConversationFromCache(targetId: number) {
    const cached = conversationCache.get(targetId)
    if (!cached) return false

    setConversationCache(targetId, cached)
    messages.value = cached.messages
    hasMore.value = cached.hasMore
    messageCursor.value = cached.cursor
    messageLoadState.value = 'loaded'
    messageLoadError.value = ''
    restorePendingLocalMessagesForCurrentContact()
    return true
  }

  function compareMessageOrder(a: Message, b: Message) {
    const aTime = new Date(a.createdAt).getTime()
    const bTime = new Date(b.createdAt).getTime()
    if (aTime !== bTime) return aTime - bTime
    return a.id - b.id
  }

  function mergeLatestMessages(existing: Message[], latest: Message[]) {
    const merged = [...existing]
    for (const message of latest) {
      appendOrReplaceMessageInList(merged, message)
    }
    merged.sort(compareMessageOrder)
    return merged
  }

  async function refreshCachedConversation(targetId: number, requestSeq: number) {
    const generation = storeGeneration
    try {
      const res = await getMessages(targetId, undefined, 20, 'init')
      if (
        generation !== storeGeneration ||
        requestSeq !== cacheRefreshSeq ||
        currentContact.value?.userId !== targetId ||
        res.data.code !== 200
      ) {
        return
      }

      const { messages: latest, hasMore: more, nextCursor } = res.data.data
      const hadCachedMessages = messages.value.length > 0
      confirmServerMessagesFromHistory(latest)
      messages.value = mergeLatestMessages(messages.value, latest)
      restorePendingLocalMessagesForCurrentContact()

      if (!hadCachedMessages) {
        hasMore.value = more
        messageCursor.value = nextCursor || (
          latest.length > 0 ? String(new Date(latest[0].createdAt).getTime()) : ''
        )
      }

      messageLoadState.value = 'loaded'
      messageLoadError.value = ''
      saveCurrentConversationToCache()
    } catch (error) {
      console.debug('Failed to refresh cached conversation', error)
    }
  }

  async function loadContacts() {
    const generation = storeGeneration
    const userStore = useUserStore()
    const sessionUserId = userStore.userId
    try {
      const res = await getContacts()
      if (generation !== storeGeneration || sessionUserId !== userStore.userId) return
      if (res.data.code === 200) {
        contacts.value = res.data.data
      }
    } catch (e) {
      console.error('Failed to load contacts', e)
    }
  }

  async function selectContact(targetId: number) {
    if (recoveringMessages) {
      recoverySeq += 1
      recoveringMessages = false
      failSentPendingMessages('消息同步中断，请点击重试')
    }

    saveCurrentConversationToCache()
    initLoadSeq += 1
    loadMoreSeq += 1
    const refreshSeq = ++cacheRefreshSeq

    const c = contacts.value.find((c) => c.userId === targetId)
    if (c) {
      currentContact.value = c
      // 不在这里清 unreadCount，等消息被看到（IntersectionObserver）再清
    }

    if (restoreConversationFromCache(targetId)) {
      if (currentContact.value?.userId === targetId && isDocumentVisible()) {
        sendWsMessage({ type: 'read', data: { targetId } })
      }
      void refreshCachedConversation(targetId, refreshSeq)
      return
    }

    messages.value = []
    hasMore.value = false
    messageCursor.value = ''
    messageLoadState.value = 'idle'
    messageLoadError.value = ''
    const loaded = await loadMessages('init')
    // 发送已读请求，让后端标记已读；隐藏标签页不能仅因选中会话就标已读
    if (loaded && currentContact.value?.userId === targetId && isDocumentVisible()) {
      sendWsMessage({ type: 'read', data: { targetId } })
    }
  }

  async function loadMessages(mode: 'init' | 'loadMore' = 'init', pageSize = 20) {
    if (mode === 'loadMore' && recoveringMessages) return false
    const targetId = currentContact.value?.userId
    if (!targetId) return false
    const requestSeq = mode === 'init' ? ++initLoadSeq : ++loadMoreSeq
    if (mode === 'init') {
      loadMoreSeq++
      messageLoadState.value = 'loading'
      messageLoadError.value = ''
    }
    try {
      let cursor: string | undefined
      if (mode === 'loadMore' && messages.value.length > 0) {
        cursor = messageCursor.value
        if (!cursor) {
          // Rolling-deploy fallback for an older backend that does not return nextCursor yet.
          cursor = String(new Date(messages.value[0].createdAt).getTime())
        }
      }
      const res = await getMessages(targetId, cursor, Math.min(Math.max(pageSize, 1), 100), mode)
      if (res.data.code === 200) {
        const { messages: msgs, hasMore: more, nextCursor } = res.data.data
        const isLatest = mode === 'init'
          ? requestSeq === initLoadSeq
          : requestSeq === loadMoreSeq
        if (currentContact.value?.userId !== targetId || !isLatest) {
          confirmServerMessagesFromHistory(msgs)
          return false
        }
        if (mode === 'init') {
          messages.value = msgs
          confirmServerMessagesFromHistory()
          restorePendingLocalMessagesForCurrentContact()
        } else {
          messages.value = [...msgs, ...messages.value]
          confirmServerMessagesFromHistory(msgs)
        }
        hasMore.value = more
        messageCursor.value = nextCursor || (
          msgs.length > 0 ? String(new Date(msgs[0].createdAt).getTime()) : ''
        )
        if (mode === 'init') {
          messageLoadState.value = 'loaded'
          messageLoadError.value = ''
        }
        saveCurrentConversationToCache()
        return true
      }
    } catch (e) {
      console.error('Failed to load messages', e)
    }
    if (mode === 'init' && currentContact.value?.userId === targetId && requestSeq === initLoadSeq) {
      messageLoadState.value = 'error'
      messageLoadError.value = '消息加载失败，请重试'
    }
    return false
  }

  async function retryInitialMessages() {
    return loadMessages('init')
  }

  async function ensureMessageLoaded(messageId: number) {
    if (messageId <= 0) return false
    if (messages.value.some((message) => message.id === messageId)) return true

    const targetId = currentContact.value?.userId
    if (!targetId) return false

    let pages = 0
    while (currentContact.value?.userId === targetId && hasMore.value && pages < 50) {
      const loaded = await loadMessages('loadMore', 100)
      if (!loaded) return false
      if (messages.value.some((message) => message.id === messageId)) return true
      pages += 1
    }
    return false
  }

  function trackLocalMessage(message: Message) {
    if (message.clientMsgId) pendingLocalMessages.set(message.clientMsgId, message)
  }

  function untrackLocalMessage(clientMsgId: string) {
    pendingLocalMessages.delete(clientMsgId)
  }

  function findLocalByClientMsgId(clientMsgId: string) {
    return messages.value.find((m) => m.clientMsgId === clientMsgId) || pendingLocalMessages.get(clientMsgId)
  }

  function restorePendingLocalMessagesForCurrentContact() {
    const userStore = useUserStore()
    const target = currentContact.value
    if (!target || !userStore.userId) return
    for (const local of pendingLocalMessages.values()) {
      if (!local.clientMsgId) continue
      if (!belongsToConversation(local, userStore.userId, target.userId)) continue
      if (!messages.value.find((m) => m.clientMsgId === local.clientMsgId)) {
        messages.value.push(local)
      }
    }
  }

  function setLocalStatus(clientMsgId: string, status: LocalMessageStatus, error = '') {
    const local = findLocalByClientMsgId(clientMsgId)
    if (!local) return
    local.localStatus = status
    local.localError = error || undefined
  }

  function clearSendTimer(clientMsgId: string) {
    const timer = sendTimers.get(clientMsgId)
    if (timer) clearTimeout(timer)
    sendTimers.delete(clientMsgId)
  }

  function queueChatPayload(payload: WsClientChat['data']) {
    const msg: WsClientChat = { type: 'chat', data: payload }
    const clientMsgId = payload.clientMsgId
    if (clientMsgId) {
      const existingIndex = pendingMessages.findIndex((pending) => pending.data.clientMsgId === clientMsgId)
      if (existingIndex >= 0) {
        pendingMessages[existingIndex] = msg
        return
      }
    }
    pendingMessages.push(msg)
  }

  function armSendTimer(clientMsgId: string, socketAtSend: WebSocket | null = ws.value) {
    clearSendTimer(clientMsgId)
    const timer = setTimeout(() => {
      try {
        const local = findLocalByClientMsgId(clientMsgId)
        if (!local || local.localStatus === 'sent') return
        const currentSocket = ws.value
        const sentSocketWasReplaced = socketAtSend !== null && currentSocket !== socketAtSend
        if (sentSocketWasReplaced || currentSocket?.readyState !== WebSocket.OPEN) {
          queueChatPayload(chatPayloadFromMessage(local))
          local.localStatus = 'queued'
          local.localError = '网络断开，恢复后自动发送'
          if (!recoveringMessages && currentSocket?.readyState === WebSocket.OPEN) flushQueue()
          return
        }
        local.localStatus = 'failed'
        local.localError = '发送超时，点击重试'
      } finally {
        if (sendTimers.get(clientMsgId) === timer) {
          sendTimers.delete(clientMsgId)
        }
      }
    }, 15000)
    sendTimers.set(clientMsgId, timer)
  }

  function removePendingMessage(clientMsgId: string) {
    for (let i = pendingMessages.length - 1; i >= 0; i--) {
      if (pendingMessages[i].data.clientMsgId === clientMsgId) {
        pendingMessages.splice(i, 1)
      }
    }
  }

  function isLikelyConfirmedByHistory(clientMsgId: string, local: Message, server: Message) {
    if (local.senderId !== server.senderId || local.receiverId !== server.receiverId || local.msgType !== server.msgType) return false
    if (local.content !== server.content) return false
    if (local.fileName !== server.fileName || local.fileSize !== server.fileSize) return false
    if ((local.replyToMessageId ?? null) !== (server.replyToMessageId ?? null)) return false
    const sentAt = sentClientMsgTimes.get(clientMsgId)
    const serverTime = new Date(server.createdAt).getTime()
    if (!sentAt || !Number.isFinite(serverTime)) return false
    return Math.abs(serverTime - sentAt) <= 120_000
  }

  function confirmServerMessagesFromHistory(serverMessages = messages.value) {
    for (const msg of serverMessages) {
      if (msg.clientMsgId) {
        clearSendTimer(msg.clientMsgId)
        removePendingMessage(msg.clientMsgId)
        untrackLocalMessage(msg.clientMsgId)
        sentClientMsgIds.delete(msg.clientMsgId)
        sentClientMsgTimes.delete(msg.clientMsgId)
        continue
      }
      for (const [clientMsgId, local] of pendingLocalMessages) {
        if (!sentClientMsgIds.has(clientMsgId)) continue
        if (!isLikelyConfirmedByHistory(clientMsgId, local, msg)) continue
        clearSendTimer(clientMsgId)
        removePendingMessage(clientMsgId)
        untrackLocalMessage(clientMsgId)
        sentClientMsgIds.delete(clientMsgId)
        sentClientMsgTimes.delete(clientMsgId)
        break
      }
    }
  }

  function isUploadSessionCurrent(options: {
    generation: number
    userId: number
    local: Message
  }) {
    const userStore = useUserStore()
    return (
      storeGeneration === options.generation &&
      userStore.userId === options.userId &&
      userStore.isLoggedIn() &&
      !!options.local.clientMsgId &&
      pendingLocalMessages.get(options.local.clientMsgId) === options.local
    )
  }

  function appendOrReplaceMessageInList(targetMessages: Message[], msg: Message) {
    const serverMessage = {
      ...msg,
      localStatus: undefined,
      localError: undefined,
      uploadProgress: undefined,
      localFile: undefined,
    }

    if (msg.clientMsgId) {
      const localIndex = targetMessages.findIndex((m) => m.clientMsgId === msg.clientMsgId)
      if (localIndex >= 0) {
        targetMessages[localIndex] = serverMessage
        return
      }
    }

    const existingIndex = targetMessages.findIndex((m) => m.id === msg.id)
    if (existingIndex >= 0) {
      targetMessages[existingIndex] = serverMessage
      return
    }

    targetMessages.push(serverMessage)
  }

  function appendOrReplaceMessage(msg: Message) {
    if (msg.clientMsgId) {
      clearSendTimer(msg.clientMsgId)
      removePendingMessage(msg.clientMsgId)
      untrackLocalMessage(msg.clientMsgId)
    }
    appendOrReplaceMessageInList(messages.value, msg)
  }

  function appendOrReplaceCachedMessage(targetId: number, msg: Message) {
    const cached = conversationCache.get(targetId)
    if (!cached) return
    appendOrReplaceMessageInList(cached.messages, msg)
    setConversationCache(targetId, cached)
  }

  function markCachedConversationRead(readerId: number, currentUserId: number) {
    const cached = conversationCache.get(readerId)
    if (!cached) return

    for (let i = cached.messages.length - 1; i >= 0; i--) {
      const message = cached.messages[i]
      if (message.senderId !== currentUserId) continue
      if (message.isRead === 1) break
      message.isRead = 1
    }
  }

  function messagePreview(message: Message) {
    switch (message.msgType) {
      case 1:
      case 4:
        return message.content || ''
      case 2:
        return '[图片]'
      case 5:
        return '[视频]'
      case 6:
        return '[语音]'
      case 3:
      default:
        return message.fileName || '[文件]'
    }
  }

  function sendChatPayload(payload: WsClientChat['data']) {
    const msg: WsClientChat = { type: 'chat', data: payload }
    if (recoveringMessages && payload.clientMsgId && sentClientMsgIds.has(payload.clientMsgId)) {
      queueChatPayload(payload)
      setLocalStatus(payload.clientMsgId, 'queued', '正在同步消息，稍后发送')
      return
    }
    const socket = ws.value
    if (socket && socket.readyState === WebSocket.OPEN) {
      if (payload.clientMsgId) {
        removePendingMessage(payload.clientMsgId)
      }
      socket.send(JSON.stringify(msg))
      if (payload.clientMsgId) {
        sentClientMsgIds.add(payload.clientMsgId)
        sentClientMsgTimes.set(payload.clientMsgId, Date.now())
        setLocalStatus(payload.clientMsgId, 'sending')
        armSendTimer(payload.clientMsgId, socket)
      }
    } else {
      queueChatPayload(payload)
      if (payload.clientMsgId) {
        setLocalStatus(payload.clientMsgId, 'queued', '网络断开，恢复后自动发送')
      }
    }
  }

  function sendWsMessage(msg: WsClientMessage) {
    if (msg.type === 'chat') {
      sendChatPayload(msg.data)
      return
    }
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(msg))
    }
  }

  function failSentPendingMessages(message = '消息同步失败，请点击重试') {
    for (let i = pendingMessages.length - 1; i >= 0; i--) {
      const clientMsgId = pendingMessages[i].data.clientMsgId
      if (!clientMsgId || !sentClientMsgIds.has(clientMsgId)) continue
      pendingMessages.splice(i, 1)
      sentClientMsgIds.delete(clientMsgId)
      sentClientMsgTimes.delete(clientMsgId)
      const local = findLocalByClientMsgId(clientMsgId)
      if (local) {
        local.localStatus = 'failed'
        local.localError = message
      }
    }
  }

  function flushQueue() {
    const socket = ws.value
    while (pendingMessages.length > 0 && socket?.readyState === WebSocket.OPEN) {
      const msg = pendingMessages.shift()!
      if (msg.data.clientMsgId) {
        sentClientMsgIds.add(msg.data.clientMsgId)
        sentClientMsgTimes.set(msg.data.clientMsgId, Date.now())
        setLocalStatus(msg.data.clientMsgId, 'sending')
        armSendTimer(msg.data.clientMsgId, socket)
      }
      socket.send(JSON.stringify(msg))
    }
  }

  function sendMessage(content: string, msgType: 1 | 4 = 1, replyTo: Message | null = null) {
    const userStore = useUserStore()
    if (!currentContact.value || !userStore.userId) return

    const clientMsgId = createClientMsgId()
    const receiverId = currentContact.value.userId
    const local = createLocalMessage({
      currentUserId: userStore.userId,
      receiverId,
      msgType,
      content,
      fileId: null,
      fileUrl: null,
      fileName: null,
      fileSize: null,
      clientMsgId,
      status: wsConnected.value ? 'sending' : 'queued',
      replyTo,
    })
    messages.value.push(local)
    const tracked = messages.value[messages.value.length - 1]
    trackLocalMessage(tracked)
    sendChatPayload(chatPayloadFromMessage(tracked))
  }

  function retryMessage(clientMsgId: string) {
    const local = findLocalByClientMsgId(clientMsgId)
    if (!local) return
    if (local.localFile && !local.fileUrl) {
      retryFileMessage(local)
      return
    }
    if (!currentContact.value) return
    local.localError = undefined
    local.localStatus = wsConnected.value ? 'sending' : 'queued'
    sendChatPayload(chatPayloadFromMessage(local))
  }

  function enqueueFileUpload(options: {
    local: Message
    file: File
    userId: number
    generation: number
    onProgress?: (p: number) => void
  }) {
    const { local, file, userId, generation, onProgress } = options
    const clientMsgId = local.clientMsgId
    if (!clientMsgId) return

    chatUploadQueue.enqueue({
      id: clientMsgId,
      size: file.size,
      onQueued: () => {
        if (!isUploadSessionCurrent({ generation, userId, local })) return
        local.localStatus = 'upload_queued'
        local.localError = undefined
        local.uploadProgress = 0
      },
      onStart: () => {
        if (!isUploadSessionCurrent({ generation, userId, local })) return
        local.localStatus = 'uploading'
        local.localError = undefined
      },
      onCancelled: () => {
        if (!isUploadSessionCurrent({ generation, userId, local })) return
        local.localStatus = 'cancelled'
        local.localError = '上传已取消'
      },
      run: async (signal) => {
        try {
          const res = await uploadFile(file, local.receiverId, (progress) => {
            if (!isUploadSessionCurrent({ generation, userId, local })) return
            local.uploadProgress = progress
            onProgress?.(progress)
          }, signal)
          if (!isUploadSessionCurrent({ generation, userId, local })) return
          if (signal.aborted) {
            local.localStatus = 'cancelled'
            local.localError = '上传已取消'
            return
          }
          if (res.data.code !== 200) {
            local.localStatus = 'failed'
            local.localError = res.data.message || '上传失败，点击重试'
            return
          }

          const { fileId, url, fileName, fileSize } = res.data.data
          local.fileId = fileId
          local.fileUrl = url
          local.fileName = fileName
          local.fileSize = fileSize
          local.uploadProgress = 100
          local.localStatus = wsConnected.value ? 'sending' : 'queued'

          sendChatPayload({
            receiverId: local.receiverId,
            msgType: local.msgType,
            content: null,
            fileId,
            fileUrl: url,
            fileName,
            fileSize,
            replyToMessageId: local.replyToMessageId,
            clientMsgId,
          })
        } catch (error) {
          if (!isUploadSessionCurrent({ generation, userId, local })) return
          if (signal.aborted) {
            local.localStatus = 'cancelled'
            local.localError = '上传已取消'
            return
          }
          console.error('File upload failed', error)
          local.localStatus = 'failed'
          local.localError = '上传失败，点击重试'
        }
      },
    })
  }

  function sendFile(file: File, onProgress?: (p: number) => void, replyTo: Message | null = null) {
    const userStore = useUserStore()
    const userId = userStore.userId
    const receiverId = getAttachmentRecipientId(file) ?? currentContact.value?.userId
    if (!userId || !receiverId) return

    const generation = storeGeneration
    const clientMsgId = createClientMsgId()
    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    const isAudio = file.type.startsWith('audio/')
    const local = createLocalMessage({
      currentUserId: userId,
      receiverId,
      msgType: isImage ? 2 : isVideo ? 5 : isAudio ? 6 : 3,
      content: null,
      fileId: null,
      fileUrl: null,
      fileName: file.name,
      fileSize: file.size,
      clientMsgId,
      status: 'upload_queued',
      localFile: file,
      uploadProgress: 0,
      replyTo,
    })

    if (currentContact.value?.userId === receiverId) messages.value.push(local)
    trackLocalMessage(local)
    enqueueFileUpload({ local, file, userId, generation, onProgress })
  }

  function retryFileMessage(local: Message) {
    const userStore = useUserStore()
    if (!local.clientMsgId || !local.localFile || !userStore.userId) return

    const generation = storeGeneration
    const userId = userStore.userId
    trackLocalMessage(local)
    enqueueFileUpload({
      local,
      file: local.localFile,
      userId,
      generation,
    })
  }

  function cancelUpload(clientMsgId: string) {
    chatUploadQueue.cancel(clientMsgId)
  }

  function handleWsMessage(data: WsServerMessage) {
    const userStore = useUserStore()
    switch (data.type) {
      case 'chat': {
        const msg = data.data
        if (msg.clientMsgId) {
          clearSendTimer(msg.clientMsgId)
          removePendingMessage(msg.clientMsgId)
          untrackLocalMessage(msg.clientMsgId)
          sentClientMsgIds.delete(msg.clientMsgId)
          sentClientMsgTimes.delete(msg.clientMsgId)
        }
        const contactId = msg.senderId === userStore.userId ? msg.receiverId : msg.senderId
        if (currentContact.value && belongsToConversation(msg, userStore.userId, currentContact.value.userId)) {
          appendOrReplaceMessage(msg)
          saveCurrentConversationToCache()
          // 不在这里发 read，由可见消息检查负责
        } else {
          appendOrReplaceCachedMessage(contactId, msg)
        }
        const contact = contacts.value.find((c) => c.userId === contactId)
        if (contact) {
          contact.lastMessage = messagePreview(msg)
          contact.lastMessageTime = msg.createdAt
          if (shouldIncrementUnread({
            senderId: msg.senderId,
            currentUserId: userStore.userId,
            contactId,
            currentContactId: currentContact.value?.userId ?? null,
            documentVisible: isDocumentVisible(),
          })) {
            contact.unreadCount++
          }
        }
        break
      }
      case 'read': {
        const readerId = data.data.readerId
        if (currentContact.value && readerId === currentContact.value.userId) {
          for (let i = messages.value.length - 1; i >= 0; i--) {
            const m = messages.value[i]
            if (m.senderId === userStore.userId) {
              if (m.isRead === 1) break
              m.isRead = 1
            }
          }
          currentContact.value.unreadCount = 0
        }
        markCachedConversationRead(readerId, userStore.userId)
        const readerContact = contacts.value.find(c => c.userId === readerId)
        if (readerContact) readerContact.unreadCount = 0
        break
      }
      case 'online': {
        const contact = contacts.value.find((c) => c.userId === data.data.userId)
        if (contact) {
          contact.online = data.data.online
          if (!data.data.online && data.data.lastSeenAt) contact.lastSeenAt = data.data.lastSeenAt
        }
        if (currentContact.value && currentContact.value.userId === data.data.userId) {
          currentContact.value.online = data.data.online
          if (!data.data.online && data.data.lastSeenAt) currentContact.value.lastSeenAt = data.data.lastSeenAt
        }
        break
      }
      case 'availability': {
        const applyAvailability = (contact: Contact | null) => {
          if (!contact || contact.userId !== data.data.userId) return
          contact.availabilityStartAt = data.data.startAt
          contact.availabilityEndAt = data.data.endAt
          contact.availabilityNote = data.data.note
        }
        applyAvailability(contacts.value.find((c) => c.userId === data.data.userId) ?? null)
        applyAvailability(currentContact.value)
        break
      }
    }
  }

  function scheduleReconnect() {
    if (intentionalClose || reconnecting || reconnectTimer) return
    const userStore = useUserStore()
    if (!userStore.isLoggedIn()) {
      clearState()
      forceLogout()
      return
    }
    const delay = Math.min(3000 * Math.pow(2, reconnectAttempts), 30000)
    reconnectAttempts++
    reconnecting = true
    wsStatus.value = 'reconnecting'
    console.debug(`WebSocket: ${delay / 1000}s 后重连 (第 ${reconnectAttempts} 次)`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connectWs()
    }, delay)
  }

  function clearHeartbeatTimer() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
  }

  function clearConnectTimer() {
    if (connectTimer) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
  }

  function clearRecoveredNoticeTimer() {
    if (recoveredNoticeTimer) {
      clearTimeout(recoveredNoticeTimer)
      recoveredNoticeTimer = null
    }
  }

  function clearReconnectCheckTimer() {
    if (reconnectCheckTimer) {
      clearTimeout(reconnectCheckTimer)
      reconnectCheckTimer = null
    }
  }

  function detachWsHandlers(socket: WebSocket) {
    socket.onopen = null
    socket.onmessage = null
    socket.onclose = null
    socket.onerror = null
  }

  function closeWsWithoutReconnect(socket: WebSocket) {
    detachWsHandlers(socket)
    socket.close()
  }

  function reconnectNow() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    clearConnectTimer()
    reconnecting = false
    reconnectAttempts = 0
    intentionalClose = true
    clearHeartbeatTimer()
    if (ws.value) closeWsWithoutReconnect(ws.value)
    ws.value = null
    intentionalClose = false
    connectWs()
  }

  function connectWs() {
    const userStore = useUserStore()
    if (!userStore.isLoggedIn()) return

    clearConnectTimer()
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    clearHeartbeatTimer()
    wsConnected.value = false

    if (ws.value) {
      closeWsWithoutReconnect(ws.value)
      ws.value = null
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const socket = new WebSocket(`${protocol}//${host}/ws/chat`)
    ws.value = socket

    connectTimer = setTimeout(() => {
      if (ws.value !== socket || socket.readyState === WebSocket.OPEN) return
      closeWsWithoutReconnect(socket)
      if (ws.value === socket) ws.value = null
      wsConnected.value = false
      reconnecting = false
      scheduleReconnect()
    }, 10000)

    socket.onopen = () => {
      if (ws.value !== socket) return
      clearConnectTimer()
      const shouldShowRecovered = reconnectAttempts > 0 || wsStatus.value === 'reconnecting'
      wsConnected.value = true
      wsStatus.value = 'connected'
      clearRecoveredNoticeTimer()
      recoveredNotice.value = shouldShowRecovered
      if (recoveredNotice.value) {
        recoveredNoticeTimer = setTimeout(() => {
          recoveredNotice.value = false
          recoveredNoticeTimer = null
        }, 1800)
      }
      reconnecting = false
      reconnectAttempts = 0
      heartbeatTimer = setInterval(() => {
        sendWsMessage({ type: 'heartbeat', data: {} })
      }, 25000)
      if (currentContact.value) {
        const currentRecoverySeq = ++recoverySeq
        recoveringMessages = true
        void loadMessages('init').then((loaded) => {
          if (currentRecoverySeq !== recoverySeq) return
          recoveringMessages = false
          if (!loaded) failSentPendingMessages()
          flushQueue()
        }).catch(() => {
          if (currentRecoverySeq !== recoverySeq) return
          recoveringMessages = false
        })
      } else {
        recoveringMessages = false
        flushQueue()
      }
    }

    socket.onmessage = (event) => {
      if (ws.value !== socket) return
      try {
        const data: WsServerMessage = JSON.parse(event.data)
        notifyWsMessage(data)
        if (data.type === 'kicked') {
          intentionalClose = true
          clearState()
          forceLogout(data.data.message || '账号已在其他设备登录')
          return
        }
        if (data.type === 'heartbeat_ack') {
          wsConnected.value = true
          clearReconnectCheckTimer()
        } else {
          handleWsMessage(data)
        }
      } catch (e) {
        console.error('Failed to parse WS message', e)
      }
    }

    socket.onclose = () => {
      if (ws.value !== socket) return
      wsConnected.value = false
      clearHeartbeatTimer()
      clearConnectTimer()
      if (!intentionalClose) {
        reconnecting = false
        scheduleReconnect()
      } else {
        reconnecting = false
        wsStatus.value = 'disconnected'
      }
    }

    socket.onerror = () => {
      socket.close()
    }
  }

  function disconnectWs() {
    intentionalClose = true
    reconnecting = false
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer)
      heartbeatTimer = null
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (connectTimer) {
      clearTimeout(connectTimer)
      connectTimer = null
    }
    clearRecoveredNoticeTimer()
    clearReconnectCheckTimer()
    recoveredNotice.value = false
    if (ws.value) {
      ws.value.close()
      ws.value = null
    }
    wsConnected.value = false
    wsStatus.value = 'disconnected'
    intentionalClose = false
  }

  function clearState() {
    storeGeneration += 1
    chatUploadQueue.clear()
    disconnectWs()
    reconnectAttempts = 0
    for (const timer of sendTimers.values()) clearTimeout(timer)
    sendTimers.clear()
    pendingMessages.length = 0
    pendingLocalMessages.clear()
    sentClientMsgIds.clear()
    sentClientMsgTimes.clear()
    recoverySeq += 1
    cacheRefreshSeq += 1
    recoveringMessages = false
    conversationCache.clear()
    clearRecoveredNoticeTimer()
    recoveredNotice.value = false
    contacts.value = []
    currentContact.value = null
    messages.value = []
    hasMore.value = false
    messageCursor.value = ''
    messageLoadState.value = 'idle'
    messageLoadError.value = ''
  }

  function tryReconnect() {
    const userStore = useUserStore()
    if (!userStore.isLoggedIn() || reconnecting || reconnectTimer) return
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      try {
        wsConnected.value = false
        ws.value.send(JSON.stringify({ type: 'heartbeat', data: {} }))
      } catch {
        reconnectAttempts = 0
        scheduleReconnect()
        return
      }
      clearReconnectCheckTimer()
      reconnectCheckTimer = setTimeout(() => {
        reconnectCheckTimer = null
        if (!wsConnected.value && !reconnecting && !reconnectTimer) {
          if (ws.value) {
            closeWsWithoutReconnect(ws.value)
            ws.value = null
          }
          reconnectAttempts = 0
          scheduleReconnect()
        }
      }, 2000)
      return
    }
    reconnectAttempts = 0
    scheduleReconnect()
  }

  if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        tryReconnect()
      }
    })
    window.addEventListener('pageshow', () => {
      tryReconnect()
    })
    window.addEventListener('online', () => {
      tryReconnect()
    })
  }

  return {
    contacts,
    currentContact,
    messages,
    hasMore,
    messageLoadState,
    messageLoadError,
    wsConnected,
    wsStatus,
    pendingChatCount,
    recoveredNotice,
    sortedContacts,
    loadContacts,
    selectContact,
    loadMessages,
    retryInitialMessages,
    ensureMessageLoaded,
    sendMessage,
    sendFile,
    retryMessage,
    cancelUpload,
    connectWs,
    disconnectWs,
    reconnectNow,
    clearState,
    sendWsMessage,
    onWsMessage,
  }
})