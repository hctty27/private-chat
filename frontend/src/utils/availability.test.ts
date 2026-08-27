import { describe, expect, it } from 'vitest'
import type { Contact } from '../types'
import { formatContactPresence, formatPlannedOnline, hasPlannedAvailability } from './availability'

function contact(overrides: Partial<Contact> = {}): Contact {
  return {
    userId: 2,
    nickname: '鲍勃',
    online: false,
    lastSeenAt: null,
    availabilityStartAt: null,
    availabilityEndAt: null,
    availabilityNote: null,
    lastMessage: '',
    lastMessageTime: '',
    unreadCount: 0,
    ...overrides,
  }
}

describe('planned online presence', () => {
  const now = new Date(2026, 7, 27, 18, 0, 0)

  it('prefers real online state over a plan', () => {
    expect(formatContactPresence(contact({
      online: true,
      availabilityStartAt: new Date(2026, 7, 27, 20, 0, 0).toISOString(),
      availabilityEndAt: new Date(2026, 7, 27, 21, 0, 0).toISOString(),
    }), now)).toBe('在线')
  })

  it('shows a future same-day plan', () => {
    const text = formatPlannedOnline(
      new Date(2026, 7, 27, 21, 30, 0).toISOString(),
      new Date(2026, 7, 27, 22, 30, 0).toISOString(),
      now,
    )
    expect(text).toBe('今天 21:30 上线')
  })

  it('hides expired plans', () => {
    const value = contact({
      availabilityStartAt: new Date(2026, 7, 27, 16, 0, 0).toISOString(),
      availabilityEndAt: new Date(2026, 7, 27, 17, 0, 0).toISOString(),
    })
    expect(hasPlannedAvailability(value, now)).toBe(false)
    expect(formatContactPresence(value, now)).toBe('离线')
  })

  it('can hide last seen while keeping online and planned states', () => {
    const offline = contact({
      lastSeenAt: new Date(2026, 7, 27, 17, 30, 0).toISOString(),
    })
    expect(formatContactPresence(offline, now, false)).toBe('离线')

    const planned = contact({
      lastSeenAt: new Date(2026, 7, 27, 17, 30, 0).toISOString(),
      availabilityStartAt: new Date(2026, 7, 27, 21, 30, 0).toISOString(),
      availabilityEndAt: new Date(2026, 7, 27, 22, 30, 0).toISOString(),
    })
    expect(formatContactPresence(planned, now, false)).toBe('今天 21:30 上线')
  })
})
