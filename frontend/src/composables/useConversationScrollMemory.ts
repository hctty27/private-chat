import type { ConversationScrollAnchor } from './useChatScroll'

export interface ConversationScrollMemory {
  remember(contactId: number, anchor: ConversationScrollAnchor | null): void
  get(contactId: number): ConversationScrollAnchor | null
  clear(contactId: number): void
  clearAll(): void
}

export function useConversationScrollMemory(): ConversationScrollMemory {
  return {
    remember: () => undefined,
    get: () => null,
    clear: () => undefined,
    clearAll: () => undefined,
  }
}
