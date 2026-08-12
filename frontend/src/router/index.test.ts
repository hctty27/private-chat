import { beforeEach, describe, expect, it, vi } from 'vitest'
import router from './index'

describe('login route privacy gate', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('consumes the cover entry permit so the next login entry returns to cover', () => {
    const loginRoute = router.getRoutes().find((route) => route.name === 'login')
    expect(loginRoute?.beforeEnter).toBeTypeOf('function')

    const guard = loginRoute?.beforeEnter as Exclude<typeof loginRoute.beforeEnter, undefined>
    const next = vi.fn()

    window.sessionStorage.setItem('fromCover', 'true')
    ;(guard as Function)({}, {}, next)

    expect(next).toHaveBeenCalledWith()
    expect(window.sessionStorage.getItem('fromCover')).toBeNull()

    next.mockClear()
    ;(guard as Function)({}, {}, next)

    expect(next).toHaveBeenCalledWith('/')
  })
})
