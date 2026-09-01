import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import VoiceCallButton from './VoiceCallButton.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

describe('VoiceCallButton', () => {
  it('renders the call chooser in body instead of inside the chat header', async () => {
    const wrapper = mount(VoiceCallButton, { attachTo: document.body })

    await wrapper.get('[aria-label="发起通话"]').trigger('click')
    await nextTick()

    expect(document.body.querySelector('.call-menu-layer')).not.toBeNull()
    expect(document.body.querySelector('[aria-label="选择通话方式"]')).not.toBeNull()

    wrapper.unmount()
  })

  it('emits the selected audio and video call type', async () => {
    const wrapper = mount(VoiceCallButton, { attachTo: document.body })

    await wrapper.get('[aria-label="发起通话"]').trigger('click')
    await nextTick()
    const audio = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.includes('语音通话'))
    audio?.click()
    await nextTick()

    await wrapper.get('[aria-label="发起通话"]').trigger('click')
    await nextTick()
    const video = Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
      .find((button) => button.textContent?.includes('视频通话'))
    video?.click()
    await nextTick()

    expect(wrapper.emitted('call')).toEqual([['audio'], ['video']])

    wrapper.unmount()
  })

  it('closes the chooser when tapping the backdrop', async () => {
    const wrapper = mount(VoiceCallButton, { attachTo: document.body })

    await wrapper.get('[aria-label="发起通话"]').trigger('click')
    await nextTick()

    const layer = document.body.querySelector<HTMLElement>('.call-menu-layer')
    layer?.click()
    await nextTick()

    expect(document.body.querySelector('.call-menu-layer')).toBeNull()

    wrapper.unmount()
  })
})
