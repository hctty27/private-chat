import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { Contact, Message, WsClientMessage, WsServerMessage } from '../types'
import { getContacts, getMessages, uploadFile } from '../api'
import { useUserStore } from './user'

export const useChatStore = defineStore('chat', () => {
  const contacts = ref<Contact[]>([])
  const currentContact = ref<Contact | null>(null)
  const messages = ref<Message[]>([])
  const hasMore = ref(false)
  const ws = ref<WebSocket | null>(null)
  const wsConnected = ref(false)
  // connected | disconnected | reconnecting
  const wsStatus = ref<'connected' | 'disconnected' | 'reconnecting'>('disconnected')
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let reconnectAttempts = 0
  let intentionalClose = false
  let reconnecting = false
  const pendingMessages: WsClientMessage[] = []

  const sortedContacts = computed(() =>
    [...contacts.value].sort((a, b) => {
      if (!a.lastMessageTime) return 1
      if (!b.lastMessageTime) return -1
      return new Date(b.lastMessageTime).getTime() - new Date(a.lastMessageTime).getTime()
    })
  )

  async function loadContacts() {
    try {
      const res = await getContacts()
      if (res.data.code === 200) {
        contacts.value = res.data.data
      }
    } catch (e) {
      console.error('Failed to load contacts', e)
    }
  }

  async function selectContact(targetId: number) {
    const c = contacts.value.find((c) => c.userId === targetId)
    if (c) {
      currentContact.value = c
      // 不在这里清 unreadCount，等消息被看到（IntersectionObserver）再清
    }
    messages.value = []
    hasMore.value = false
    await loadMessages('init')
    // 发送已读请求，让后端标记已读
    sendWsMessage({ type: 'read', data: { targetId } })
  }

  async function loadMessages(mode: 'init' | 'loadMore' = 'init') {
    if (!currentContact.value) return
    try {
    let cursor: string | undefined
    if (mode === 'loadMore' && messages.value.length > 0) {
      const d = new Date(messages.value[0].createdAt)
      cursor = String(d.getTime())  // 传毫秒时间戳
    }
    const res = await getMessages(currentContact.value.userId, cursor, 20, mode)
      if (res.data.code === 200) {
        const { messages: msgs, hasMore: more } = res.data.data
        if (mode === 'init') {
          messages.value = msgs
        } else {
          messages.value = [...msgs, ...messages.value]
        }
        hasMore.value = more
      }
    } catch (e) {
      console.error('Failed to load messages', e)
    }
  }

  function sendWsMessage(msg: WsClientMessage) {
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      ws.value.send(JSON.stringify(msg))
    } else if (msg.type === 'chat') {
      pendingMessages.push(msg)
    }
  }

  function flushQueue() {
    while (pendingMessages.length > 0 && ws.value?.readyState === WebSocket.OPEN) {
      const msg = pendingMessages.shift()!
      ws.value.send(JSON.stringify(msg))
    }
  }

  function sendMessage(content: string, msgType: 1 | 4 = 1) {
    if (!currentContact.value) return
    sendWsMessage({
      type: 'chat',
      data: {
        receiverId: currentContact.value.userId,
        msgType,
        content,
        fileUrl: null,
        fileName: null,
        fileSize: null,
      },
    })
  }

  async function sendFile(file: File, onProgress?: (p: number) => void) {
    if (!currentContact.value) return
    try {
      const res = await uploadFile(file, onProgress)
      if (res.data.code === 200) {
        const { url, fileName, fileSize } = res.data.data
        const isImage = file.type.startsWith('image/')
        const isVideo = file.type.startsWith('video/')
        sendWsMessage({
          type: 'chat',
          data: {
            receiverId: currentContact.value.userId,
            msgType: isImage ? 2 : isVideo ? 5 : 3,
            content: null,
            fileUrl: url,
            fileName,
            fileSize,
          },
        })
      }
    } catch (e) {
      console.error('File upload failed', e)
      throw e
    }
  }

  function handleWsMessage(data: WsServerMessage) {
    const userStore = useUserStore()
    switch (data.type) {
      case 'chat': {
        const msg = data.data
        // If message belongs to current conversation, add to list
        if (currentContact.value) {
          const isCurrent =
            (msg.senderId === userStore.userId && msg.receiverId === currentContact.value.userId) ||
            (msg.senderId === currentContact.value.userId && msg.receiverId === userStore.userId)
          if (isCurrent) {
            // Avoid duplicates
            if (!messages.value.find((m) => m.id === msg.id)) {
              messages.value.push(msg)
            }
            // 不在这里发 read，由 IntersectionObserver 在消息进入视口时触发
          }
        }
        // Update contact last message
        const contactId = msg.senderId === userStore.userId ? msg.receiverId : msg.senderId
        const contact = contacts.value.find((c) => c.userId === contactId)
        if (contact) {
          contact.lastMessage = msg.content || msg.fileName
            ? (msg.msgType === 2 ? '[图片]' : msg.msgType === 5 ? '[视频]' : msg.fileName || '[文件]')
            : '[文件]'
          contact.lastMessageTime = msg.createdAt
          if (msg.senderId !== userStore.userId && (!currentContact.value || currentContact.value.userId !== contactId)) {
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
        // 同步清联系人列表角标
        const readerContact = contacts.value.find(c => c.userId === readerId)
        if (readerContact) readerContact.unreadCount = 0
        break
      }
      case 'online': {
        const contact = contacts.value.find((c) => c.userId === data.data.userId)
        if (contact) {
          contact.online = data.data.online
        }
        if (currentContact.value && currentContact.value.userId === data.data.userId) {
          currentContact.value.online = data.data.online
        }
        break
      }
    }
  }

  function scheduleReconnect() {
    if (intentionalClose || reconnecting || reconnectTimer) return
    const userStore = useUserStore()
    if (!userStore.token) {
      userStore.logout()
      window.location.href = '/'
      return
    }
    const delay = Math.min(3000 * Math.pow(2, reconnectAttempts), 30000)
    reconnectAttempts++
    reconnecting = true
    wsStatus.value = 'reconnecting'
    console.log(`WebSocket: ${delay / 1000}s 后重连 (第 ${reconnectAttempts} 次)`)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      connectWs()
    }, delay)
  }

  function connectWs() {
    const userStore = useUserStore()
    if (!userStore.token) return

    // 清理旧连接
    if (ws.value) {
      intentionalClose = true
      ws.value.close()
      intentionalClose = false
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    ws.value = new WebSocket(`${protocol}//${host}/ws/chat?token=${userStore.token}`)

    ws.value.onopen = () => {
      wsConnected.value = true
      wsStatus.value = 'connected'
      reconnecting = false
      reconnectAttempts = 0
      heartbeatTimer = setInterval(() => {
        sendWsMessage({ type: 'heartbeat', data: {} })
      }, 25000)
      // 补拉断连期间的消息
      if (currentContact.value) {
        loadMessages('init')
      }
      // 补发队列中的消息
      flushQueue()
    }

    ws.value.onmessage = (event) => {
      try {
        const data: WsServerMessage = JSON.parse(event.data)
        if (data.type === 'kicked') {
          intentionalClose = true
          userStore.logout()
          disconnectWs()
          window.location.href = '/'
          return
        }
        if (data.type !== 'heartbeat_ack') {
          handleWsMessage(data)
        }
      } catch (e) {
        console.error('Failed to parse WS message', e)
      }
    }

    ws.value.onclose = () => {
      wsConnected.value = false
      if (heartbeatTimer) clearInterval(heartbeatTimer)
      if (!intentionalClose) {
        scheduleReconnect()
      } else {
        reconnecting = false
        wsStatus.value = 'disconnected'
      }
    }

    ws.value.onerror = () => {
      ws.value?.close()
    }
  }

  function disconnectWs() {
    intentionalClose = true
    reconnecting = false
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    if (ws.value) {
      ws.value.close()
      ws.value = null
    }
    wsConnected.value = false
    wsStatus.value = 'disconnected'
    intentionalClose = false
  }

  function clearState() {
    disconnectWs()
    reconnectAttempts = 0
    pendingMessages.length = 0
    contacts.value = []
    currentContact.value = null
    messages.value = []
    hasMore.value = false
  }

  function tryReconnect() {
    const userStore = useUserStore()
    if (!userStore.token || reconnecting || reconnectTimer) return
    // 已连接则不需要重连
    if (wsConnected.value) return
    // 先尝试 ping 检测连接是否真正存活（手机后台挂起后 readyState 可能仍为 OPEN）
    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      try {
        ws.value.send(JSON.stringify({ type: 'heartbeat', data: {} }))
      } catch {
        // 发送失败说明连接已死
        reconnectAttempts = 0
        scheduleReconnect()
        return
      }
      // 2s 内没恢复则认为连接已死，强制重连
      setTimeout(() => {
        if (!wsConnected.value && !reconnecting && !reconnectTimer) {
          reconnectAttempts = 0
          scheduleReconnect()
        }
      }, 2000)
      return
    }
    // 连接不存在或已关闭，直接重连
    reconnectAttempts = 0
    scheduleReconnect()
  }

  // 监听标签页可见性和网络状态
  if (typeof window !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        tryReconnect()
      }
    })
    // pageshow 比 visibilitychange 更可靠，特别是从后台切回时
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
    wsConnected,
    wsStatus,
    sortedContacts,
    loadContacts,
    selectContact,
    loadMessages,
    sendMessage,
    sendFile,
    connectWs,
    disconnectWs,
    clearState,
    sendWsMessage,
  }
})
