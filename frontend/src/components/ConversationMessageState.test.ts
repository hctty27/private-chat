import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import ConversationMessageState from './ConversationMessageState.vue'

describe('ConversationMessageState', () => {
  it('shows loading but not empty copy while pending', () => {
    const wrapper = mount(ConversationMessageState, {
      props: { state: 'loading', hasMessages: false },
    })

    expect(wrapper.text()).toContain('加载消息中...')
    expect(wrapper.text()).not.toContain('开始聊天吧')
  })

  it('shows empty copy only after loaded', () => {
    const wrapper = mount(ConversationMessageState, {
      props: { state: 'loaded', hasMessages: false },
    })

    expect(wrapper.text()).toBe('开始聊天吧')
  })

  it('shows retry UI on error and emits retry', async () => {
    const wrapper = mount(ConversationMessageState, {
      props: {
        state: 'error',
        hasMessages: false,
        error: '消息加载失败，请重试',
      },
    })

    expect(wrapper.text()).toContain('消息加载失败')
    const retry = wrapper.get('button')
    expect(retry.text()).toBe('重新加载')
    await retry.trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('renders no state panel when messages exist', () => {
    const wrapper = mount(ConversationMessageState, {
      props: { state: 'loading', hasMessages: true },
    })

    expect(wrapper.text()).toBe('')
  })
})
