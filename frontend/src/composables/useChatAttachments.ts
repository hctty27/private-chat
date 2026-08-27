import { nextTick, ref, type Ref } from 'vue'
import { useChatStore } from '../stores/chat'
import { useAttachmentComposer } from './useAttachmentComposer'
import { useAttachmentIngress } from './useAttachmentIngress'

type AttachmentScrollController = {
  isNearBottom: (threshold?: number) => boolean
  scrollToBottomAndClear: (smooth?: boolean) => void
}

export function useChatAttachments(options: {
  emojiOpen: Ref<boolean>
  scroll: AttachmentScrollController
  onWarning: (message: string) => void
  maxBytes?: number
  maxFiles?: number
}) {
  const chatStore = useChatStore()
  const progress = ref(0)
  const uploadBusy = ref(false)

  function currentRecipient() {
    const contact = chatStore.currentContact
    return contact ? { id: contact.userId, nickname: contact.nickname } : null
  }

  const attachmentComposer = useAttachmentComposer({
    getCurrentRecipient: currentRecipient,
    onRecipientMismatch: () => options.onWarning('联系人已切换，请重新选择文件'),
  })

  const attachmentIngress = useAttachmentIngress({
    maxBytes: options.maxBytes ?? 50 * 1024 * 1024,
    maxFiles: options.maxFiles ?? 9,
    getRecipient: currentRecipient,
    onStage: (files, recipient) => {
      options.emojiOpen.value = false
      attachmentComposer.stage(files, recipient)
    },
    onWarning: options.onWarning,
  })

  async function uploadFiles(files: File[]) {
    const fileProgress = Array.from({ length: files.length }, () => 0)
    let followBatch = options.scroll.isNearBottom(160)
    progress.value = 0

    try {
      for (let index = 0; index < files.length; index++) {
        const sendPromise = chatStore.sendFile(files[index], (value) => {
          fileProgress[index] = value
          progress.value = Math.round(
            fileProgress.reduce((sum, item) => sum + item, 0) / files.length,
          )
        })

        await nextTick()
        if (followBatch) options.scroll.scrollToBottomAndClear(false)

        await sendPromise
        await nextTick()
        if (followBatch && !options.scroll.isNearBottom(320)) followBatch = false
      }
    } finally {
      progress.value = 0
    }
  }

  async function uploadConfirmed(beforeUpload?: () => void) {
    const files = attachmentComposer.takeConfirmed()
    if (!files?.length || uploadBusy.value) return false

    beforeUpload?.()
    uploadBusy.value = true
    try {
      await uploadFiles(files)
      return true
    } finally {
      uploadBusy.value = false
    }
  }

  return {
    attachmentComposer,
    attachmentIngress,
    progress,
    uploadBusy,
    uploadFiles,
    uploadConfirmed,
  }
}
