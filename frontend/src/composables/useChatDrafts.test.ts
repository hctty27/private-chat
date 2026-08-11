import { describe, expect, it } from 'vitest'
import { useChatDrafts } from './useChatDrafts'

describe('useChatDrafts', () => {
  it('isolates drafts by contact id', () => {
    const drafts = useChatDrafts()

    drafts.set(1, 'Alice draft')
    drafts.set(2, 'Bob draft')

    expect(drafts.get(1)).toBe('Alice draft')
    expect(drafts.get(2)).toBe('Bob draft')
    expect(drafts.get(3)).toBe('')
  })

  it('clears one contact without clearing others', () => {
    const drafts = useChatDrafts()
    drafts.set(1, 'A')
    drafts.set(2, 'B')

    drafts.clear(1)

    expect(drafts.get(1)).toBe('')
    expect(drafts.get(2)).toBe('B')
  })

  it('clears all drafts', () => {
    const drafts = useChatDrafts()
    drafts.set(1, 'A')
    drafts.set(2, 'B')

    drafts.clearAll()

    expect(drafts.get(1)).toBe('')
    expect(drafts.get(2)).toBe('')
  })
})
