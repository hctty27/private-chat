import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import MessageActionMenu from './MessageActionMenu.vue'

const wrappers: Array<{ unmount(): void }> = []

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
})

function mountMenu(options: { x?: number; y?: number } = {}) {
  const wrapper = mount(MessageActionMenu, {
    props: {
      visible: true,
      actions: ['copy', 'retry'],
      x: options.x ?? 40,
      y: options.y ?? 60,
    },
    global: { stubs: { teleport: true } },
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('MessageActionMenu', () => {
  it('renders only the provided action labels', () => {
    const wrapper = mountMenu()

    expect(wrapper.text()).toContain('复制')
    expect(wrapper.text()).toContain('重试')
    expect(wrapper.text()).not.toContain('保存')
  })

  it('focuses the first action when opened', async () => {
    const wrapper = mountMenu()
    await wrapper.vm.$nextTick()

    expect(document.activeElement?.textContent).toContain('复制')
  })

  it('moves focus through actions with arrow keys', async () => {
    const wrapper = mountMenu()
    await wrapper.vm.$nextTick()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(document.activeElement?.textContent).toContain('重试')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))
    expect(document.activeElement?.textContent).toContain('复制')

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }))
    expect(document.activeElement?.textContent).toContain('重试')
  })

  it('emits one action and closes after selection', async () => {
    const wrapper = mountMenu()
    const copy = wrapper.findAll('button').find((button) => button.text() === '复制')

    await copy!.trigger('click')

    expect(wrapper.emitted('action')).toEqual([['copy']])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes on Escape', async () => {
    const wrapper = mountMenu()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes on an outside pointer interaction', async () => {
    const wrapper = mountMenu()

    await wrapper.get('.message-action-overlay').trigger('pointerdown')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('clamps negative desktop coordinates to the viewport inset', () => {
    const wrapper = mountMenu({ x: -100, y: -50 })
    const style = wrapper.get('.message-action-menu').attributes('style')

    expect(style).toContain('left: 8px')
    expect(style).toContain('top: 8px')
  })
})
