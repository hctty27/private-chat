import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUserStore } from '../stores/user'

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
}))

vi.mock('../api', () => ({
  checkSession: mocks.checkSession,
}))

import { installSessionRecovery } from './sessionRecovery'

describe('session recovery', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    mocks.checkSession.mockReset()
    mocks.checkSession.mockResolvedValue({ data: { code: 200, data: { userId: 7 } } })
    useUserStore().login('valid-token', 7, 'User')
  })

  it('checks the server session immediately and again after pageshow', async () => {
    const cleanup = installSessionRecovery()
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.checkSession).toHaveBeenCalledTimes(1)
    mocks.checkSession.mockClear()

    window.dispatchEvent(new Event('pageshow'))
    await Promise.resolve()
    await Promise.resolve()

    expect(mocks.checkSession).toHaveBeenCalledTimes(1)
    cleanup?.()
  })
})
