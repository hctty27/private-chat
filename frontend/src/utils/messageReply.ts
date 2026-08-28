import type { Message, MessageReply } from '../types'

type ReplySource = Pick<MessageReply, 'msgType' | 'content' | 'fileName'>

function compactText(value: string | null | undefined) {
  const text = (value ?? '').replace(/\s+/g, ' ').trim()
  if (text.length <= 80) return text
  return `${text.slice(0, 80)}…`
}

export function messageReplySummary(message: ReplySource) {
  if (message.msgType === 2) return '[图片]'
  if (message.msgType === 5) return '[视频]'
  if (message.msgType === 3) {
    const name = compactText(message.fileName)
    return name ? `[文件] ${name}` : '[文件]'
  }

  const content = compactText(message.content)
  return content || '[消息]'
}

export function toMessageReply(message: Message): MessageReply {
  return {
    messageId: message.id,
    senderId: message.senderId,
    msgType: message.msgType,
    content: message.content,
    fileName: message.fileName,
  }
}
