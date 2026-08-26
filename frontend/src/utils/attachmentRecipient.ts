const attachmentRecipientByFile = new WeakMap<File, number>()

export function bindAttachmentRecipient(files: readonly File[], receiverId: number) {
  for (const file of files) attachmentRecipientByFile.set(file, receiverId)
}

export function getAttachmentRecipientId(file: File) {
  return attachmentRecipientByFile.get(file) ?? null
}
