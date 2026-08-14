import { describe, expect, it } from 'vitest'
import { useConversationScrollMemory } from './useConversationScrollMemory'

describe('useConversationScrollMemory', () => {
  it('isolates anchors by contact id', () => {
    const memory = useConversationScrollMemory()
    memory.remember(1, { messageId: 10, offset: 4 })
    memory.remember(2, { messageId: 20, offset: 8 })

    expect(memory.get(1)).toEqual({ messageId: 10, offset: 4 })
    expect(memory.get(2)).toEqual({ messageId: 20, offset: 8 })
  })

  it('overwrites one contact without changing another', () => {
    const memory = useConversationScrollMemory()
    memory.remember(1, { messageId: 10, offset: 4 })
    memory.remember(2, { messageId: 20, offset: 8 })

    memory.remember(1, { messageId: 11, offset: 5 })

    expect(memory.get(1)).toEqual({ messageId: 11, offset: 5 })
    expect(memory.get(2)).toEqual({ messageId: 20, offset: 8 })
  })

  it('clears one contact', () => {
    const memory = useConversationScrollMemory()
    memory.remember(1, { messageId: 10, offset: 4 })
    memory.remember(2, { messageId: 20, offset: 8 })

    memory.clear(1)

    expect(memory.get(1)).toBeNull()
    expect(memory.get(2)).toEqual({ messageId: 20, offset: 8 })
  })

  it('clears all contacts', () => {
    const memory = useConversationScrollMemory()
    memory.remember(1, { messageId: 10, offset: 4 })
    memory.remember(2, { messageId: 20, offset: 8 })

    memory.clearAll()

    expect(memory.get(1)).toBeNull()
    expect(memory.get(2)).toBeNull()
  })

  it('stores and returns immutable copies', () => {
    const memory = useConversationScrollMemory()
    const anchor = { messageId: 10, offset: 4 }
    memory.remember(1, anchor)
    anchor.offset = 99

    const firstRead = memory.get(1)
    expect(firstRead).toEqual({ messageId: 10, offset: 4 })

    if (firstRead) firstRead.offset = 77
    expect(memory.get(1)).toEqual({ messageId: 10, offset: 4 })
  })
})
