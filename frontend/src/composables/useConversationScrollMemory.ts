import type { ConversationScrollAnchor } from './useChatScroll'

export interface ConversationScrollMemory {
  remember(contactId: number, anchor: ConversationScrollAnchor | null): void
  get(contactId: number): ConversationScrollAnchor | null
  clear(contactId: number): void
  clearAll(): void
}

export function useConversationScrollMemory(): ConversationScrollMemory {
  const anchors = new Map<number, ConversationScrollAnchor>()

  function remember(contactId: number, anchor: ConversationScrollAnchor | null) {
    if (anchor) anchors.set(contactId, { ...anchor })
    else anchors.delete(contactId)
  }

  function get(contactId: number) {
    const anchor = anchors.get(contactId)
    return anchor ? { ...anchor } : null
  }

  function clear(contactId: number) {
    anchors.delete(contactId)
  }

  function clearAll() {
    anchors.clear()
  }

  return {
    remember,
    get,
    clear,
    clearAll,
  }
}
