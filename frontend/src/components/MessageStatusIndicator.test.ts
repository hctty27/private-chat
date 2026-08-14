import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import MessageStatusIndicator from './MessageStatusIndicator.vue'
import type { LocalMessageStatus } from '../types'

describe('MessageStatusIndicator', () => {
  it.each<[LocalMessageStatus, string]>([
    ['uploading', '上传中'],
    ['queued', '排队中'],
    ['sending', '发送中'],
    ['failed', '发送失败'],
  ])('renders %s status', (status, text) => {
    const wrapper = mount(MessageStatusIndicator, {
      props: {
        status,
        isRead: false,
        progress: status === 'uploading' ? 42 : undefined,
      },
    })

    expect(wrapper.text()).toContain(text)
  })

  it('emits retry from a failed message', async () => {
    const wrapper = mount(MessageStatusIndicator, {
      props: { status: 'failed', isRead: false },
    })

    await wrapper.get('button').trigger('click')

    expect(wrapper.emitted('retry')).toHaveLength(1)
  })

  it('shows read state when showReadState is true and no local status exists', () => {
    const read = mount(MessageStatusIndicator, {
      props: { isRead: true, showReadState: true },
    })
    const unread = mount(MessageStatusIndicator, {
      props: { isRead: false, showReadState: true },
    })

    expect(read.text()).toBe('已读')
    expect(unread.text()).toBe('未读')
  })

  it('renders no read text when showReadState is false and no local status exists', () => {
    const wrapper = mount(MessageStatusIndicator, {
      props: { isRead: false, showReadState: false },
    })

    expect(wrapper.text()).toBe('')
  })

  it('keeps local failure feedback even when read state is disabled', () => {
    const wrapper = mount(MessageStatusIndicator, {
      props: {
        status: 'failed',
        isRead: false,
        showReadState: false,
      },
    })

    expect(wrapper.text()).toContain('发送失败')
    expect(wrapper.find('button').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('未读')
  })
})
