import { readonly, ref, type Ref } from 'vue'
import { bindAttachmentRecipient } from '../utils/attachmentRecipient'

export interface AttachmentRecipient {
  id: number
  nickname: string
}

export interface StagedAttachment {
  files: File[]
  recipient: AttachmentRecipient
}

export function useAttachmentComposer(options: {
  getCurrentRecipient: () => AttachmentRecipient | null
  onRecipientMismatch: () => void
}): {
  staged: Readonly<Ref<StagedAttachment | null>>
  stage(files: File[], recipient: AttachmentRecipient): void
  cancel(): void
  takeConfirmed(): File[] | null
} {
  const staged = ref<StagedAttachment | null>(null)

  function stage(files: File[], recipient: AttachmentRecipient) {
    bindAttachmentRecipient(files, recipient.id)
    staged.value = {
      files: [...files],
      recipient: { ...recipient },
    }
  }

  function cancel() {
    staged.value = null
  }

  function takeConfirmed(): File[] | null {
    const pending = staged.value
    if (!pending) return null

    staged.value = null
    const current = options.getCurrentRecipient()
    if (!current || current.id !== pending.recipient.id) {
      options.onRecipientMismatch()
      return null
    }
    return [...pending.files]
  }

  return {
    staged: readonly(staged) as Readonly<Ref<StagedAttachment | null>>,
    stage,
    cancel,
    takeConfirmed,
  }
}
