import { computed, type Ref } from 'vue'
import { useChatStore } from '../stores/chat'
import { shouldShowTimeSeparator } from '../utils/time'
import type { Message } from '../types'

export function useChatMessageUi(uid: Ref<number>) {
  const chatStore = useChatStore()

  const lastSelfMessageIndex = computed(() => {
    for (let index = chatStore.messages.length - 1; index >= 0; index--) {
      if (chatStore.messages[index].senderId === uid.value) return index
    }
    return -1
  })

  function showTimeByIndex(index: number) {
    if (index === 0) return true
    return shouldShowTimeSeparator(
      chatStore.messages[index].createdAt,
      chatStore.messages[index - 1].createdAt,
    )
  }

  function isLastSelfMessage(index: number) {
    return index === lastSelfMessageIndex.value
  }

  function shouldShowMessageStatus(index: number) {
    const message = chatStore.messages[index]
    if (!message || message.senderId !== uid.value) return false
    return !!message.localStatus || isLastSelfMessage(index)
  }

  function isPendingMediaMessage(message: Message) {
    return (message.msgType === 2 || message.msgType === 3 || message.msgType === 5) && !message.fileUrl
  }

  function pendingMediaText(message: Message) {
    if (message.msgType === 2) return '📷 图片准备中'
    if (message.msgType === 5) return '🎬 视频准备中'
    return `📎 ${message.fileName || '文件准备中'}`
  }

  function bubbleType(message: { msgType: number; senderId: number }) {
    if (message.msgType === 4) return 'emoji'
    return message.senderId === uid.value ? 'mine' : 'his'
  }

  function onImageLoaded(event: Event) {
    const image = event.currentTarget
    if (image instanceof HTMLImageElement) image.classList.add('loaded')
  }

  function fallbackImageToOriginal(event: Event, message: Message) {
    const image = event.currentTarget
    if (!(image instanceof HTMLImageElement) || !message.fileId || !message.fileUrl) return
    if (image.dataset.originalFallback === '1') return
    image.dataset.originalFallback = '1'
    image.src = message.fileUrl
  }

  function videoPosterUrl(message: Pick<Message, 'fileId'>) {
    return message.fileId ? `/api/files/${message.fileId}/thumbnail` : ''
  }

  return {
    showTimeByIndex,
    isLastSelfMessage,
    shouldShowMessageStatus,
    isPendingMediaMessage,
    pendingMediaText,
    bubbleType,
    onImageLoaded,
    fallbackImageToOriginal,
    videoPosterUrl,
  }
}
