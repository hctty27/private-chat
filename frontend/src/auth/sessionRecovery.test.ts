import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useUserStore } from '../stores/user'

const mocks = vi.hoisted(() => ({
  checkSession: vi.fn(),
}))

vi.mock('../api', () => ({
  checkSession: mocks.checkSession,
}))

import { installSessionRecovery, verifyCurrentSession } from './sessionRecovery'

describe('session recovery', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
    mocks.checkSession.mockReset()
    mocks.checkSession.mockResolvedValue({ data: { code: 200, data: { userId: 7, nickname: 'User' } } })
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
    useUserStore().login(7, 'User')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('checks the server session immediately and again after pageshow', async () => {
    const cleanup = installSessionRecovery()
    await verifyCurrentSession()

    expect(mocks.checkSession).toHaveBeenCalledTimes(1)
    mocks.checkSession.mockClear()

    window.dispatchEvent(new Event('pageshow'))
    await verifyCurrentSession()

    expect(mocks.checkSession).toHaveBeenCalledTimes(1)
    cleanup?.()
  })
})
