import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import VoiceCallOverlay from './VoiceCallOverlay.vue'
import IncomingCallOverlay from './IncomingCallOverlay.vue'

const wrappers: Array<{ unmount(): void }> = []

afterEach(() => {
  while (wrappers.length) wrappers.pop()?.unmount()
  vi.restoreAllMocks()
})

function mountVoice(props: Partial<InstanceType<typeof VoiceCallOverlay>['$props']> = {}) {
  const wrapper = mount(VoiceCallOverlay, {
    props: {
      phase: 'outgoing',
      peerName: 'Alice',
      durationSeconds: 0,
      muted: false,
      error: '',
      remoteStream: null,
      ...props,
    } as any,
  })
  wrappers.push(wrapper)
  return wrapper
}

describe('VoiceCallOverlay', () => {
  it('shows outgoing and connected call status', async () => {
    const wrapper = mountVoice()
    expect(wrapper.text()).toContain('正在呼叫…')

    await wrapper.setProps({ phase: 'connected', durationSeconds: 65 })
    expect(wrapper.text()).toContain('01:05')
  })

  it('emits mute and hangup controls', async () => {
    const wrapper = mountVoice({ phase: 'connected' })
    const buttons = wrapper.findAll('button')
    await buttons.find((button) => button.attributes('aria-label') === '静音')!.trigger('click')
    await buttons.find((button) => button.attributes('aria-label') === '挂断语音通话')!.trigger('click')

    expect(wrapper.emitted('toggle-mute')).toHaveLength(1)
    expect(wrapper.emitted('hangup')).toHaveLength(1)
  })

  it('shows terminal error text', () => {
    const wrapper = mountVoice({ phase: 'failed', error: '通话连接失败' })
    expect(wrapper.text()).toContain('通话失败')
    expect(wrapper.text()).toContain('通话连接失败')
  })

  it('attaches remote stream to autoplay playsinline audio element', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const stream = {} as MediaStream
    const wrapper = mountVoice({ phase: 'connected', remoteStream: stream })
    await flushPromises()

    const audio = wrapper.get('audio').element as HTMLAudioElement
    expect(audio.autoplay).toBe(true)
    expect(audio.hasAttribute('playsinline')).toBe(true)
    expect(audio.srcObject).toBe(stream)
    expect(play).toHaveBeenCalled()
  })

  it('shows a resume-audio action when audio play is rejected', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValueOnce(new Error('blocked'))
      .mockResolvedValueOnce()
    const wrapper = mountVoice({ phase: 'connected', remoteStream: {} as MediaStream })
    await flushPromises()

    const resume = wrapper.findAll('button').find((button) => button.text() === '点击恢复声音')
    expect(resume).toBeTruthy()
    await resume!.trigger('click')
    await flushPromises()

    expect(play).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).not.toContain('点击恢复声音')
  })
})

describe('IncomingCallOverlay', () => {
  it('shows caller name and emits accept/reject', async () => {
    const wrapper = mount(IncomingCallOverlay, { props: { peerName: 'Alice' } })
    wrappers.push(wrapper)

    expect(wrapper.text()).toContain('Alice')
    expect(wrapper.text()).toContain('邀请你语音通话')

    await wrapper.get('[aria-label="接听语音通话"]').trigger('click')
    await wrapper.get('[aria-label="拒绝语音通话"]').trigger('click')

    expect(wrapper.emitted('accept')).toHaveLength(1)
    expect(wrapper.emitted('reject')).toHaveLength(1)
  })
})
