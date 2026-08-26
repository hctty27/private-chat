import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AttachmentSendDialog from './AttachmentSendDialog.vue'

let objectUrlIndex = 0
const createObjectURL = vi.fn(() => `blob:preview-${++objectUrlIndex}`)
const revokeObjectURL = vi.fn()
const wrappers: Array<{ unmount(): void }> = []

beforeEach(() => {
  objectUrlIndex = 0
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL })
})

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  createObjectURL.mockClear()
  revokeObjectURL.mockClear()
})

function mountDialog(options: { busy?: boolean; files?: File[] } = {}) {
  const files = options.files ?? [new File(['hello'], 'photo.png', { type: 'image/png' })]
  const wrapper = mount(AttachmentSendDialog, {
    props: {
      visible: true,
      files,
      recipientName: 'Alice',
      busy: options.busy ?? false,
    },
    global: { stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('AttachmentSendDialog', () => {
  it('shows recipient, file metadata and image preview for a single attachment', () => {
    const wrapper = mountDialog()

    expect(wrapper.get('[role="dialog"]').attributes('aria-modal')).toBe('true')
    expect(wrapper.text()).toContain('发送给：Alice')
    expect(wrapper.text()).toContain('photo.png')
    expect(wrapper.text()).toContain('5 B')
    expect(wrapper.get('img').attributes('src')).toBe('blob:preview-1')
  })

  it('shows every image in a batch and the batch count', () => {
    const wrapper = mountDialog({
      files: [
        new File(['a'], 'a.png', { type: 'image/png' }),
        new File(['bb'], 'b.jpg', { type: 'image/jpeg' }),
        new File(['ccc'], 'c.webp', { type: 'image/webp' }),
      ],
    })

    expect(wrapper.findAll('.batch-preview img')).toHaveLength(3)
    expect(wrapper.text()).toContain('3 张图片')
    expect(wrapper.get('button.primary').text()).toBe('发送 3 张')
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
    const confirm = wrapper.get('button.primary')

    expect(confirm.text()).toBe('发送中…')
    expect(confirm.attributes('disabled')).toBeDefined()
  })

  it('emits cancel on Escape', async () => {
    const wrapper = mountDialog()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('revokes object URLs when files change and on unmount', async () => {
    const wrapper = mountDialog()
    const nextFiles = [
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.jpg', { type: 'image/jpeg' }),
    ]

    await wrapper.setProps({ files: nextFiles })
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-1')

    wrapper.unmount()
    wrappers.splice(wrappers.indexOf(wrapper), 1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(3)
  })
})
