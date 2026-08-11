import { reactive } from 'vue'

export interface ChatDrafts {
  get(contactId: number): string
  set(contactId: number, value: string): void
  clear(contactId: number): void
  clearAll(): void
}

export function useChatDrafts(): ChatDrafts {
  const drafts = reactive(new Map<number, string>())

  return {
    get: (contactId) => drafts.get(contactId) ?? '',
    set: (contactId, value) => {
      if (value) drafts.set(contactId, value)
      else drafts.delete(contactId)
    },
    clear: (contactId) => drafts.delete(contactId),
    clearAll: () => drafts.clear(),
  }
}
