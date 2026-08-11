import type { Message } from '../types'

export type MessageAction = 'copy' | 'view' | 'open' | 'save' | 'retry'

export function getMessageActions(message: Message): MessageAction[] {
  if (message.localStatus === 'failed') {
    return message.msgType === 1 || message.msgType === 4 ? ['retry', 'copy'] : ['retry']
  }

  if (message.msgType === 1 || message.msgType === 4) return ['copy']
  if (!message.fileUrl) return []
  if (message.msgType === 2 || message.msgType === 5) return ['view', 'save']
  if (message.msgType === 3) return ['open', 'save']
  return []
}
