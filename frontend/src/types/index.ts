import type { WsCallClientMessage, WsCallServerMessage } from './call'
export * from './call'

export interface ApiResponse<T> {
  code: number
  data: T
  message?: string
}

export interface LoginResponse {
  userId: number
  nickname: string
}

export interface SessionResponse {
  userId: number
  nickname: string
}

export interface Availability {
  startAt: string
  endAt: string
  note: string | null
}

export interface Contact {
  userId: number
  nickname: string
  online: boolean
  lastSeenAt: string | null
  availabilityStartAt?: string | null
  availabilityEndAt?: string | null
  availabilityNote?: string | null
  lastMessage: string
  lastMessageTime: string
  unreadCount: number
}

export type LocalMessageStatus = 'sending' | 'sent' | 'failed' | 'queued' | 'upload_queued' | 'uploading' | 'cancelled'
export type MessageLoadState = 'idle' | 'loading' | 'loaded' | 'error'

export interface MessageReply {
  messageId: number
  senderId: number
  msgType: 1 | 2 | 3 | 4 | 5 | 6
  content: string | null
  fileName: string | null
}

export interface Message {
  id: number
  conversationId?: string
  senderId: number
  receiverId: number
  msgType: 1 | 2 | 3 | 4 | 5 | 6
  content: string | null
  fileId: number | null
  fileUrl: string | null
  fileName: string | null
  fileSize: number | null
  isRead: 0 | 1
  createdAt: string
  replyToMessageId?: number
  replyTo?: MessageReply
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

export interface FileMultipartUploadPart {
  partNumber: number
  uploadUrl: string
}

export interface FileMultipartCompletedPart {
  partNumber: number
  etag: string
}

export interface FilePresignUploadResponse extends FileUploadResponse {
  uploadMode: 'single' | 'multipart'
  uploadUrl?: string
  uploadId?: string
  partSize?: number
  parts?: FileMultipartUploadPart[]
  headers?: Record<string, string>
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

export interface WsAvailabilityMessage {
  type: 'availability'
  data: {
    userId: number
    startAt: string | null
    endAt: string | null
    note: string | null
  }
}

export interface WsHeartbeatAck {
  type: 'heartbeat_ack'
  data: {}
}

export interface WsKickedMessage {
  type: 'kicked'
  data: { message: string }
}

export type WsServerMessage = WsChatMessage | WsReadMessage | WsOnlineMessage | WsAvailabilityMessage | WsHeartbeatAck | WsKickedMessage | WsCallServerMessage

export interface WsClientChat {
  type: 'chat'
  data: {
    receiverId: number
    msgType: 1 | 2 | 3 | 4 | 5 | 6
    content: string | null
    fileId: number | null
    fileUrl: string | null
    fileName: string | null
    fileSize: number | null
    replyToMessageId?: number
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

export type WsClientMessage = WsClientChat | WsClientHeartbeat | WsClientRead | WsCallClientMessage