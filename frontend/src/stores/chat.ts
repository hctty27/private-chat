import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Contact, LocalMessageStatus, Message, MessageLoadState, WsClientChat, WsClientMessage, WsServerMessage } from '../types'
import { getContacts, getMessages, uploadFile } from '../api'
import { forceLogout } from '../auth/session'
import { useUserStore } from './user'
import { belongsToConversation, chatPayloadFromMessage, createClientMsgId, createLocalMessage } from '../utils/chatLocal'
import { getAttachmentRecipientId } from '../utils/attachmentRecipient'
import { isDocumentVisible, shouldIncrementUnread } from '../utils/chatVisibility'

export const useChatStore = defineStore('chat', () => {
  const contacts = ref<Contact[]>([])
  const currentContact = ref<Contact | null>(null)
  const messages = ref<Message[]>([])
  const hasMore = ref(false)
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
  const recoveredNotice = ref(false)
  let storeGeneration = 0
  let initLoadSeq = 0
  let loadMoreSeq = 0
  let recoverySeq = 0
  let recoveringMessages = false
  let recoveredNoticeTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectCheckTimer: ReturnType<typeof setTimeout> | null = null

  const sortedContacts = computed(() =>
    [...contacts.value].sort((a, b) => {
      if (!a.lastMessageTime) return 1
      if (!b.lastMessageTime) return -1
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
    })
  )

  const pendingChatCount = computed(() =>
    messages.value.filter((m) => m.localStatus === 'queued' || m.localStatus === 'sending' || m.localStatus === 'uploading').length
  )

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
    const c = contacts.value.find((c) => c.userId === targetId)
    if (c) {
      currentContact.value = c
      // 不在这里清 unreadCount，等消息被看到（IntersectionObserver）再清
    }
    messages.value = []
    hasMore.value = false
    messageLoadState.value = 'idle'
    messageLoadError.value = ''
    const loaded = await loadMessages('init')
    // 发送已读请求，让后端标记已读；隐藏标签页不能仅因选中会话就标已读
    if (loaded && currentContact.value?.userId === targetId && isDocumentVisible()) {
      sendWsMessage({ type: 'read', data: { targetId } })
    }
  }

  async function loadMessages(mode: 'init' | 'loadMore' = 'init') {
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
        const d = new Date(messages.value[0].createdAt)
        cursor = String(d.getTime())  // 传毫秒时间戳
      }
      const res = await getMessages(targetId, cursor, 20, mode)
      if (res.data.code === 200) {
        const { messages: msgs, hasMore: more } = res.data.data
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
        if (mode === 'init') {
          messageLoadState.value = 'loaded'
          messageLoadError.value = ''
        }
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

  function appendOrReplaceMessage(msg: Message) {
    if (msg.clientMsgId) {
      clearSendTimer(msg.clientMsgId)
      removePendingMessage(msg.clientMsgId)
      untrackLocalMessage(msg.clientMsgId)
      const localIndex = messages.value.findIndex((m) => m.clientMsgId === msg.clientMsgId)
      if (localIndex >= 0) {
        messages.value[localIndex] = {
          ...msg,
          localStatus: undefined,
          localError: undefined,
          uploadProgress: undefined,
          localFile: undefined,
        }
        return
      }
    }
    if (!messages.value.find((m) => m.id === msg.id)) {
      messages.value.push(msg)
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

  function sendMessage(content: string, msgType: 1 | 4 = 1) {
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
    })
    messages.value.push(local)
    const tracked = messages.value[messages.value.length - 1]
    trackLocalMessage(tracked)
    sendChatPayload(chatPayloadFromMessage(tracked))
  }

  function retryMessage(clientMsgId: string) {
    const local = findLocalByClientMsgId(clientMsgId)
    if (!local || !currentContact.value) return
    if (local.localFile && !local.fileUrl) {
      void retryFileMessage(local)
      return
    }
    local.localError = undefined
    local.localStatus = wsConnected.value ? 'sending' : 'queued'
    sendChatPayload(chatPayloadFromMessage(local))
  }

  async function sendFile(file: File, onProgress?: (p: number) => void) {
    const userStore = useUserStore()
    const userId = userStore.userId
    const receiverId = getAttachmentRecipientId(file) ?? currentContact.value?.userId
    if (!userId || !receiverId) return

    const generation = storeGeneration
    const clientMsgId = createClientMsgId()
    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    const local = createLocalMessage({
      currentUserId: userId,
      receiverId,
      msgType: isImage ? 2 : isVideo ? 5 : 3,
      content: null,
      fileId: null,
      fileUrl: null,
      fileName: file.name,
      fileSize: file.size,
      clientMsgId,
      status: 'uploading',
      localFile: file,
      uploadProgress: 0,
    })
    const tracked = local
    if (currentContact.value?.userId === receiverId) messages.value.push(tracked)
    trackLocalMessage(tracked)

    try {
      const res = await uploadFile(file, receiverId, p => {
        if (!isUploadSessionCurrent({ generation, userId, local: tracked })) return
        tracked.uploadProgress = p
        onProgress?.(p)
      })
      if (!isUploadSessionCurrent({ generation, userId, local: tracked })) return
      if (res.data.code !== 200) {
        tracked.localStatus = 'failed'
        tracked.localError = res.data.message || '上传失败，点击重试'
        return
      }

      const { fileId, url, fileName, fileSize } = res.data.data
      tracked.fileId = fileId
      tracked.fileUrl = url
      tracked.fileName = fileName
      tracked.fileSize = fileSize
      tracked.uploadProgress = 100
      tracked.localStatus = wsConnected.value ? 'sending' : 'queued'

      sendChatPayload({
        receiverId,
        msgType: tracked.msgType,
        content: null,
        fileId,
        fileUrl: url,
        fileName,
        fileSize,
        clientMsgId,
      })
    } catch (e) {
      if (!isUploadSessionCurrent({ generation, userId, local: tracked })) return
      console.error('File upload failed', e)
      tracked.localStatus = 'failed'
      tracked.localError = '上传失败，点击重试'
    }
  }

  async function retryFileMessage(local: Message) {
    const userStore = useUserStore()
    if (!local.clientMsgId || !local.localFile || !currentContact.value || !userStore.userId) return
    const generation = storeGeneration
    const userId = userStore.userId
    const receiverId = local.receiverId
    trackLocalMessage(local)
    local.localStatus = 'uploading'
    local.localError = undefined
    local.uploadProgress = 0

    try {
      const res = await uploadFile(local.localFile, receiverId, p => {
        if (!isUploadSessionCurrent({ generation, userId, local })) return
        local.uploadProgress = p
      })
      if (!isUploadSessionCurrent({ generation, userId, local })) return
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
        receiverId,
        msgType: local.msgType,
        content: null,
        fileId,
        fileUrl: url,
        fileName,
        fileSize,
        clientMsgId: local.clientMsgId,
      })
    } catch (e) {
      if (!isUploadSessionCurrent({ generation, userId, local })) return
      console.error('File upload retry failed', e)
      local.localStatus = 'failed'
      local.localError = '上传失败，点击重试'
    }
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
        if (currentContact.value && belongsToConversation(msg, userStore.userId, currentContact.value.userId)) {
          appendOrReplaceMessage(msg)
          // 不在这里发 read，由可见消息检查负责
        }
        const contactId = msg.senderId === userStore.userId ? msg.receiverId : msg.senderId
        const contact = contacts.value.find((c) => c.userId === contactId)
        if (contact) {
          contact.lastMessage = msg.content || msg.fileName
            ? (msg.msgType === 2 ? '[图片]' : msg.msgType === 5 ? '[视频]' : msg.fileName || '[文件]')
            : '[文件]'
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
    disconnectWs()
    reconnectAttempts = 0
    for (const timer of sendTimers.values()) clearTimeout(timer)
    sendTimers.clear()
    pendingMessages.length = 0
    pendingLocalMessages.clear()
    sentClientMsgIds.clear()
    sentClientMsgTimes.clear()
    recoverySeq += 1
    recoveringMessages = false
    clearRecoveredNoticeTimer()
    recoveredNotice.value = false
    contacts.value = []
    currentContact.value = null
    messages.value = []
    hasMore.value = false
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
    sendMessage,
    sendFile,
    retryMessage,
    connectWs,
    disconnectWs,
    reconnectNow,
    clearState,
    sendWsMessage,
  }
})