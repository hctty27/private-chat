export function isDocumentVisible() {
  return typeof document === 'undefined' ||
    !document.visibilityState ||
    document.visibilityState === 'visible'
}

export function shouldIncrementUnread(options: {
  senderId: number
  currentUserId: number
  contactId: number
  currentContactId: number | null
  documentVisible: boolean
}) {
  return options.senderId !== options.currentUserId &&
    (options.currentContactId !== options.contactId || !options.documentVisible)
}
