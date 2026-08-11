import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CoverPage from './CoverPage.vue'

const routerMocks = vi.hoisted(() => ({
  push: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: routerMocks.push }),
}))

describe('CoverPage auth privacy', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    routerMocks.push.mockClear()
  })

  it('never exposes authentication notices on the disguise page', () => {
    window.sessionStorage.setItem('loginNotice', '登录已过期，请重新进入')
    window.sessionStorage.setItem('coverNotice', '账号已在其他设备登录')

    const wrapper = mount(CoverPage)

    expect(wrapper.text()).not.toContain('登录已过期')
    expect(wrapper.text()).not.toContain('账号已在其他设备登录')
  })
})
