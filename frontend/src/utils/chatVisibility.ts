export function isDocumentVisible() {
  return typeof document === 'undefined' ||
    !document.visibilityState ||
    document.visibilityState === 'visible'
}

// Incoming messages remain unread until a visible-message receipt is acknowledged.
export function shouldIncrementUnread(senderId: number, currentUserId: number) {
  return senderId !== currentUserId
}
