import { describe, expect, it } from 'vitest'
import { shouldIncrementUnread } from './chatVisibility'

describe('chat visibility unread rules', () => {
  it('counts every incoming message until a read acknowledgement arrives', () => {
    expect(shouldIncrementUnread(2, 1)).toBe(true)
  })

  it('never increments for the current user own message', () => {
    expect(shouldIncrementUnread(1, 1)).toBe(false)
  })
})
