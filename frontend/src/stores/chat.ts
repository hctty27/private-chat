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
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

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
          messages.value.forEach((m) => {
            if (m.senderId === userStore.userId) {
              m.isRead = 1
            }
          })
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

  function connectWs() {
    const userStore = useUserStore()
    if (!userStore.token) return

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    ws.value = new WebSocket(`${protocol}//${host}/ws/chat?token=${userStore.token}`)

    ws.value.onopen = () => {
      wsConnected.value = true
      heartbeatTimer = setInterval(() => {
        sendWsMessage({ type: 'heartbeat', data: {} })
      }, 30000)
    }

    ws.value.onmessage = (event) => {
      try {
        const data: WsServerMessage = JSON.parse(event.data)
        if (data.type === 'kicked') {
          // 被踢下线
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
      // 如果 token 过期，跳转到伪装页
      if (!userStore.token) {
        userStore.logout()
        window.location.href = '/'
      } else {
        reconnectTimer = setTimeout(connectWs, 3000)
      }
    }

    ws.value.onerror = () => {
      ws.value?.close()
    }
  }

  function disconnectWs() {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (ws.value) {
      ws.value.close()
      ws.value = null
    }
    wsConnected.value = false
  }

  function clearState() {
    disconnectWs()
    contacts.value = []
    currentContact.value = null
    messages.value = []
    hasMore.value = false
  }

  return {
    contacts,
    currentContact,
    messages,
    hasMore,
    wsConnected,
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
