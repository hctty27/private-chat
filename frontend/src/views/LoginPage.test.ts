import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import LoginPage from './LoginPage.vue'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  loginApi: vi.fn(),
  userLogin: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('../api', () => ({
  login: mocks.loginApi,
}))

vi.mock('../stores/user', () => ({
  useUserStore: () => ({ login: mocks.userLogin }),
}))

vi.mock('element-plus/es/components/message/index', () => ({
  ElMessage: {
    warning: mocks.warning,
    error: mocks.error,
  },
}))

function mountLogin() {
  return mount(LoginPage, {
    global: {
      stubs: {
        'el-form': { template: '<form><slot /></form>' },
        'el-input': { template: '<input />' },
        'el-button': { template: '<button><slot /></button>' },
      },
    },
  })
}

describe('LoginPage session notice', () => {
  beforeEach(() => {
    window.sessionStorage.clear()
    vi.clearAllMocks()
  })

  it('shows and consumes a session-expired notice after the hidden entry is opened', () => {
    window.sessionStorage.setItem('loginNotice', '登录已过期，请重新进入')

    const wrapper = mountLogin()

    expect(wrapper.get('[role="status"]').text()).toBe('登录已过期，请重新进入')
    expect(window.sessionStorage.getItem('loginNotice')).toBeNull()
  })

  it('still consumes the legacy WebSocket kicked notice without exposing it on the cover page', () => {
    window.sessionStorage.setItem('coverNotice', '账号已在其他设备登录')

    const wrapper = mountLogin()

    expect(wrapper.get('[role="status"]').text()).toBe('账号已在其他设备登录')
    expect(window.sessionStorage.getItem('coverNotice')).toBeNull()
  })
})
