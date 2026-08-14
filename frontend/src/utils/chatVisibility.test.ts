import { describe, expect, it } from 'vitest'
import { shouldIncrementUnread } from './chatVisibility'

describe('chat visibility unread rules', () => {
  it('treats a hidden selected conversation as unread', () => {
    expect(shouldIncrementUnread({
      senderId: 2,
      currentUserId: 1,
      contactId: 2,
      currentContactId: 2,
      documentVisible: false,
    })).toBe(true)
  })

  it('does not increment for a visible selected conversation', () => {
    expect(shouldIncrementUnread({
      senderId: 2,
      currentUserId: 1,
      contactId: 2,
      currentContactId: 2,
      documentVisible: true,
    })).toBe(false)
  })

  it('increments for another conversation', () => {
    expect(shouldIncrementUnread({
      senderId: 2,
      currentUserId: 1,
      contactId: 2,
      currentContactId: 3,
      documentVisible: true,
    })).toBe(true)
  })

  it('never increments for the current user own message', () => {
    expect(shouldIncrementUnread({
      senderId: 1,
      currentUserId: 1,
      contactId: 2,
      currentContactId: 3,
      documentVisible: false,
    })).toBe(false)
  })
})
