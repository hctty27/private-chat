import type { Message } from '../types'

export type MessageAction = 'reply' | 'copy' | 'view' | 'open' | 'save' | 'retry'

export function getMessageActions(message: Message): MessageAction[] {
  const replyActions: MessageAction[] = message.id > 0 ? ['reply'] : []

  if (message.localStatus === 'failed') {
    return message.msgType === 1 || message.msgType === 4
      ? ['retry', ...replyActions, 'copy']
      : ['retry', ...replyActions]
  }

  if (message.msgType === 1 || message.msgType === 4) return [...replyActions, 'copy']
  if (!message.fileUrl) return replyActions
  if (message.msgType === 2 || message.msgType === 5) return [...replyActions, 'view', 'save']
  if (message.msgType === 6) return [...replyActions, 'save']
  if (message.msgType === 3) return [...replyActions, 'open', 'save']
  return replyActions
}
