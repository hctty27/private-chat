import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

const mocks = vi.hoisted(() => ({
  requestUse: vi.fn(),
  responseUse: vi.fn(),
}))

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: vi.fn(),
      get: vi.fn(),
      interceptors: {
        request: { use: mocks.requestUse },
        response: { use: mocks.responseUse },
      },
    })),
    put: vi.fn(),
  },
}))

import { useUserStore } from '../stores/user'
import { handleApiError } from './index'

describe('API auth invalidation', () => {
  beforeEach(() => {
    localStorage.clear()
    setActivePinia(createPinia())
  })

  it('clears the in-memory user session when a protected request returns 401', async () => {
    const userStore = useUserStore()
    userStore.login(42, 'Expired User')

    const error = {
      config: { url: '/api/contacts' },
      response: { status: 401 },
    }
    await expect(handleApiError(error)).rejects.toBe(error)

    expect(userStore.authenticated).toBe(false)
    expect(userStore.userId).toBe(0)
    expect(userStore.nickname).toBe('')
    expect(localStorage.getItem('token')).toBeNull()
    expect(localStorage.getItem('userId')).toBeNull()
    expect(localStorage.getItem('nickname')).toBeNull()
  })
})
