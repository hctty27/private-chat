import { nextTick, type Ref } from 'vue'
import { useChatStore } from '../stores/chat'
import { useAttachmentComposer } from './useAttachmentComposer'
import { useAttachmentIngress } from './useAttachmentIngress'
import type { Message } from '../types'

type AttachmentScrollController = {
  isNearBottom: (threshold?: number) => boolean
  scrollToBottomAndClear: (smooth?: boolean) => void
}

export function useChatAttachments(options: {
  emojiOpen: Ref<boolean>
  scroll: AttachmentScrollController
  onWarning: (message: string) => void
  maxImageBytes?: number
  maxVideoBytes?: number
  maxFileBytes?: number
  maxFiles?: number
  getReplyTo?: () => Message | null
  onReplySent?: () => void
}) {
  const chatStore = useChatStore()
  function currentRecipient() {
    const contact = chatStore.currentContact
    return contact ? { id: contact.userId, nickname: contact.nickname } : null
  }

  const attachmentComposer = useAttachmentComposer({
    getCurrentRecipient: currentRecipient,
    onRecipientMismatch: () => options.onWarning('联系人已切换，请重新选择文件'),
  })

  const attachmentIngress = useAttachmentIngress({
    maxImageBytes: options.maxImageBytes ?? 50 * 1024 * 1024,
    maxVideoBytes: options.maxVideoBytes ?? 500 * 1024 * 1024,
    maxFileBytes: options.maxFileBytes ?? 500 * 1024 * 1024,
    maxFiles: options.maxFiles ?? 9,
    getRecipient: currentRecipient,
    onStage: (files, recipient) => {
      options.emojiOpen.value = false
      attachmentComposer.stage(files, recipient)
    },
    onWarning: options.onWarning,
  })

  async function uploadFiles(files: File[]) {
    if (files.length === 0) return

    const followBatch = options.scroll.isNearBottom(160)
    const replyTo = options.getReplyTo?.() ?? null
    let firstFile = true
    for (const file of files) {
      if (firstFile && replyTo) chatStore.sendFile(file, undefined, replyTo)
      else chatStore.sendFile(file)
      firstFile = false
    }
    if (replyTo) options.onReplySent?.()

    await nextTick()
    if (followBatch) options.scroll.scrollToBottomAndClear(false)
  }

  async function uploadConfirmed(beforeUpload?: () => void) {
    const files = attachmentComposer.takeConfirmed()
    if (!files?.length) return false

    beforeUpload?.()
    await uploadFiles(files)
    return true
  }

  return {
    attachmentComposer,
    attachmentIngress,
    uploadFiles,
    uploadConfirmed,
  }
}
