export interface ApiResponse<T> {
  code: number
  data: T
  message?: string
}

export interface LoginResponse {
  token: string
  userId: number
  nickname: string
}

export interface Contact {
  userId: number
  nickname: string
  online: boolean
  lastSeenAt: string | null
  lastMessage: string
  lastMessageTime: string
  unreadCount: number
}

export type LocalMessageStatus = 'sending' | 'sent' | 'failed' | 'queued' | 'uploading'
export type MessageLoadState = 'idle' | 'loading' | 'loaded' | 'error'

export interface Message {
  id: number
  conversationId?: string
  senderId: number
  receiverId: number
  msgType: 1 | 2 | 3 | 4 | 5
  content: string | null
  fileId: number | null
  fileUrl: string | null
  fileName: string | null
  fileSize: number | null
  isRead: 0 | 1
  createdAt: string
  clientMsgId?: string
  localStatus?: LocalMessageStatus
  localError?: string
  uploadProgress?: number
  localFile?: File
}

export interface MessagesResponse {
  messages: Message[]
  hasMore: boolean
  nextCursor?: string
}

export interface FileUploadResponse {
  fileId: number
  url: string
  fileName: string
  fileSize: number
}

export interface FilePresignUploadResponse extends FileUploadResponse {
  uploadUrl: string
  headers: Record<string, string>
  thumbnailUploadUrl?: string
  thumbnailHeaders?: Record<string, string>
}

// WebSocket message types
export interface WsChatMessage {
  type: 'chat'
  data: Message
}

export interface WsReadMessage {
  type: 'read'
  data: { readerId: number; conversationId: string }
}

export interface WsOnlineMessage {
  type: 'online'
  data: { userId: number; online: boolean; lastSeenAt?: string }
}

export interface WsHeartbeatAck {
  type: 'heartbeat_ack'
  data: {}
}

export interface WsKickedMessage {
  type: 'kicked'
  data: { message: string }
}

export type WsServerMessage = WsChatMessage | WsReadMessage | WsOnlineMessage | WsHeartbeatAck | WsKickedMessage

export interface WsClientChat {
  type: 'chat'
  data: {
    receiverId: number
    msgType: 1 | 2 | 3 | 4 | 5
    content: string | null
    fileId: number | null
    fileUrl: string | null
    fileName: string | null
    fileSize: number | null
    clientMsgId?: string
  }
}

export interface WsClientHeartbeat {
  type: 'heartbeat'
  data: {}
}

export interface WsClientRead {
  type: 'read'
  data: { targetId: number }
}

export type WsClientMessage = WsClientChat | WsClientHeartbeat | WsClientRead