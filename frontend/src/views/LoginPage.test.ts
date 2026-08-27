import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
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

  it('keeps the login card centered in the dynamic app viewport', () => {
    const wrapper = mountLogin()
    const viewport = wrapper.get('div')
    const centeringLayer = viewport.get('div')

    expect(viewport.classes()).toEqual(expect.arrayContaining([
      'h-full',
      'min-h-0',
      'overflow-y-auto',
    ]))
    expect(viewport.classes()).not.toContain('min-h-screen')
    expect(centeringLayer.classes()).toEqual(expect.arrayContaining([
      'min-h-full',
      'flex',
      'items-center',
      'justify-center',
    ]))
  })

  it('shows and consumes a session-expired notice after the hidden entry is opened', async () => {
    window.sessionStorage.setItem('loginNotice', '登录已过期，请重新进入')

    const wrapper = mountLogin()
    await nextTick()

    expect(wrapper.get('[role="status"]').text()).toBe('登录已过期，请重新进入')
    expect(window.sessionStorage.getItem('loginNotice')).toBeNull()
  })

  it('still consumes the legacy WebSocket kicked notice without exposing it on the cover page', async () => {
    window.sessionStorage.setItem('coverNotice', '账号已在其他设备登录')

    const wrapper = mountLogin()
    await nextTick()

    expect(wrapper.get('[role="status"]').text()).toBe('账号已在其他设备登录')
    expect(window.sessionStorage.getItem('coverNotice')).toBeNull()
  })
})
