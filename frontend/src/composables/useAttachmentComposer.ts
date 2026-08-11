import { readonly, ref, type Ref } from 'vue'

export interface AttachmentRecipient {
  id: number
  nickname: string
}

export interface StagedAttachment {
  file: File
  recipient: AttachmentRecipient
}

export function useAttachmentComposer(options: {
  getCurrentRecipient: () => AttachmentRecipient | null
  onRecipientMismatch: () => void
}): {
  staged: Readonly<Ref<StagedAttachment | null>>
  stage(file: File, recipient: AttachmentRecipient): void
  cancel(): void
  takeConfirmed(): File | null
} {
  const staged = ref<StagedAttachment | null>(null)

  function stage(file: File, recipient: AttachmentRecipient) {
    staged.value = {
      file,
      recipient: { ...recipient },
    }
  }

  function cancel() {
    staged.value = null
  }

  function takeConfirmed(): File | null {
    const pending = staged.value
    if (!pending) return null

    staged.value = null
    const current = options.getCurrentRecipient()
    if (!current || current.id !== pending.recipient.id) {
      options.onRecipientMismatch()
      return null
    }
    return pending.file
  }

  return {
    staged: readonly(staged) as Readonly<Ref<StagedAttachment | null>>,
    stage,
    cancel,
    takeConfirmed,
  }
}
