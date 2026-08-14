export function isDocumentVisible() {
  return true
}

export function shouldIncrementUnread(_options: {
  senderId: number
  currentUserId: number
  contactId: number
  currentContactId: number | null
  documentVisible: boolean
}) {
  return false
}
