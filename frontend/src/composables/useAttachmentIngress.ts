import type { AttachmentRecipient } from './useAttachmentComposer'

export interface AttachmentIngressOptions {
  maxBytes: number
  maxFiles: number
  getRecipient: () => AttachmentRecipient | null
  onStage: (files: File[], recipient: AttachmentRecipient) => void
  onWarning: (message: string) => void
}

export interface AttachmentIngress {
  acceptFiles(files: FileList | File[]): boolean
  handlePaste(event: ClipboardEvent): boolean
  handleDrop(event: DragEvent): boolean
}

export function useAttachmentIngress(options: AttachmentIngressOptions): AttachmentIngress {
  function acceptFiles(input: FileList | File[]) {
    const files = Array.from(input)
    if (files.length === 0) return false

    if (files.length > options.maxFiles) {
      options.onWarning(`一次最多发送 ${options.maxFiles} 张图片`)
      return false
    }

    if (files.length > 1 && files.some(file => !file.type.startsWith('image/'))) {
      options.onWarning('批量发送仅支持图片')
      return false
    }

    const recipient = options.getRecipient()
    if (!recipient) return false

    if (files.some(file => file.size > options.maxBytes)) {
      options.onWarning('文件最大支持 50MB')
      return false
    }

    options.onStage(files, { ...recipient })
    return true
  }

  function handlePaste(event: ClipboardEvent) {
    const files = event.clipboardData?.files
    if (!files || files.length === 0) return false
    event.preventDefault()
    return acceptFiles(files)
  }

  function handleDrop(event: DragEvent) {
    const files = event.dataTransfer?.files
    if (!files || files.length === 0) return false
    event.preventDefault()
    return acceptFiles(files)
  }

  return {
    acceptFiles,
    handlePaste,
    handleDrop,
  }
}
