import type { LocalMessageStatus, Message, WsClientChat } from '../types'
import { toMessageReply } from './messageReply'

let clientMsgSeq = 0
let tempMessageId = -1

export function createClientMsgId() {
  clientMsgSeq += 1
  return `c_${Date.now().toString(36)}_${clientMsgSeq}`
}

export function nextTempMessageId() {
  const id = tempMessageId
  tempMessageId -= 1
  return id
}

export function conversationIdFor(a: number, b: number) {
  return a < b ? `${a}_${b}` : `${b}_${a}`
}

export function createLocalMessage(options: {
  currentUserId: number
  receiverId: number
  msgType: 1 | 2 | 3 | 4 | 5 | 6
  content: string | null
  fileId?: number | null
  fileUrl: string | null
  fileName: string | null
  fileSize: number | null
  clientMsgId: string
  status: LocalMessageStatus
  localFile?: File
  uploadProgress?: number
  replyTo?: Message | null
}): Message {
  return {
    id: nextTempMessageId(),
    conversationId: conversationIdFor(options.currentUserId, options.receiverId),
    senderId: options.currentUserId,
    receiverId: options.receiverId,
    msgType: options.msgType,
    content: options.content,
    fileId: options.fileId ?? null,
    fileUrl: options.fileUrl,
    fileName: options.fileName,
    fileSize: options.fileSize,
    isRead: 0,
    createdAt: new Date().toISOString(),
    replyToMessageId: options.replyTo && options.replyTo.id > 0 ? options.replyTo.id : undefined,
    replyTo: options.replyTo && options.replyTo.id > 0 ? toMessageReply(options.replyTo) : undefined,
    clientMsgId: options.clientMsgId,
    localStatus: options.status,
    localFile: options.localFile,
    uploadProgress: options.uploadProgress,
  }
}

export function belongsToConversation(message: Message, currentUserId: number, targetId: number) {
  return (
    (message.senderId === currentUserId && message.receiverId === targetId) ||
    (message.senderId === targetId && message.receiverId === currentUserId)
  )
}

export function chatPayloadFromMessage(message: Message): WsClientChat['data'] {
  return {
    receiverId: message.receiverId,
    msgType: message.msgType,
    content: message.content,
    fileId: message.fileId,
    fileUrl: message.fileUrl,
    fileName: message.fileName,
    fileSize: message.fileSize,
    replyToMessageId: message.replyToMessageId,
    clientMsgId: message.clientMsgId,
  }
}
