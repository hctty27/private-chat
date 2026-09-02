import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  keepSessionAlive: vi.fn(),
}))

vi.mock('../api', () => ({
  keepSessionAlive: mocks.keepSessionAlive,
}))

import { useUserStore } from '../stores/user'
import { installSessionKeepAlive, resetSessionKeepAliveForTests } from './sessionKeepAlive'

describe('session keep-alive', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-02T00:00:00Z'))
    setActivePinia(createPinia())
    mocks.keepSessionAlive.mockReset().mockResolvedValue({})
    resetSessionKeepAliveForTests()
  })

  it('renews on real interaction and throttles attempts for 15 minutes', async () => {
    useUserStore().login(42, 'Tester')
    const cleanup = installSessionKeepAlive()

    window.dispatchEvent(new Event('pointerdown'))
    await Promise.resolve()
    expect(mocks.keepSessionAlive).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    window.dispatchEvent(new Event('wheel'))
    await Promise.resolve()
    expect(mocks.keepSessionAlive).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(15 * 60 * 1000)
    window.dispatchEvent(new Event('wheel'))
    await Promise.resolve()
    expect(mocks.keepSessionAlive).toHaveBeenCalledTimes(2)

    cleanup()
  })

  it('does not renew when there is no authenticated session', async () => {
    const cleanup = installSessionKeepAlive()

    window.dispatchEvent(new Event('pointerdown'))
    await Promise.resolve()

    expect(mocks.keepSessionAlive).not.toHaveBeenCalled()
    cleanup()
  })
})
