import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AttachmentSendDialog from './AttachmentSendDialog.vue'

const createObjectURL = vi.fn(() => 'blob:preview')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
})

afterEach(() => {
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})

function mountDialog(options: { busy?: boolean; file?: File } = {}) {
  const file = options.file ?? new File(['hello'], 'photo.png', { type: 'image/png' })
  return mount(AttachmentSendDialog, {
    props: {
      visible: true,
      file,
      recipientName: 'Alice',
      busy: options.busy ?? false,
    },
    global: { stubs: { teleport: true } },
  })
}

describe('AttachmentSendDialog', () => {
  it('shows recipient, file metadata and image preview', () => {
    const wrapper = mountDialog()

    expect(wrapper.get('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.text()).toContain('发送给：Alice')
    expect(wrapper.text()).toContain('photo.png')
    expect(wrapper.text()).toContain('5 B')
    expect(wrapper.get('img').attributes('src')).toBe('blob:preview')
  })

  it('emits cancel and confirm from explicit controls', async () => {
    const wrapper = mountDialog()
    const buttons = wrapper.findAll('button')
    const cancel = buttons.find((button) => button.text() === '取消')
    const confirm = buttons.find((button) => button.text() === '发送')

    await cancel!.trigger('click')
    await confirm!.trigger('click')

    expect(wrapper.emitted('cancel')).toHaveLength(1)
    expect(wrapper.emitted('confirm')).toHaveLength(1)
  })

  it('disables confirm while busy', () => {
    const wrapper = mountDialog({ busy: true })
    const confirm = wrapper.findAll('button').find((button) => button.text() === '发送')

    expect(confirm!.attributes('disabled')).toBeDefined()
  })

  it('emits cancel on Escape', async () => {
    const wrapper = mountDialog()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('revokes object URLs when the file changes and on unmount', async () => {
    const wrapper = mountDialog()
    const second = new File(['video'], 'clip.mp4', { type: 'video/mp4' })

    await wrapper.setProps({ file: second })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview')

    wrapper.unmount()
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
  })
})
