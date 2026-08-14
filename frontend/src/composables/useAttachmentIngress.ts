import type { AttachmentRecipient } from './useAttachmentComposer'

export interface AttachmentIngressOptions {
  maxBytes: number
  getRecipient: () => AttachmentRecipient | null
  onStage: (file: File, recipient: AttachmentRecipient) => void
  onWarning: (message: string) => void
}

export interface AttachmentIngress {
  acceptFiles(files: FileList | File[]): boolean
  handlePaste(event: ClipboardEvent): boolean
  handleDrop(event: DragEvent): boolean
}

export function useAttachmentIngress(_options: AttachmentIngressOptions): AttachmentIngress {
  return {
    acceptFiles: () => false,
    handlePaste: () => false,
    handleDrop: () => false,
  }
}
