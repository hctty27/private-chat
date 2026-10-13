import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import SpeechToTextButton from './SpeechToTextButton.vue'

interface MockResult {
  isFinal: boolean
  0: { transcript: string }
}

class MockSpeechRecognition {
  static last: MockSpeechRecognition | null = null

  lang = ''
  continuous = false
  interimResults = false
  maxAlternatives = 0
  onresult: ((event: { resultIndex: number; results: MockResult[] }) => void) | null = null
  onerror: ((event: { error: string }) => void) | null = null
  onend: (() => void) | null = null
  starts = 0
  stops = 0
  aborts = 0

  constructor() {
    MockSpeechRecognition.last = this
  }

  start() {
    this.starts++
  }

  stop() {
    this.stops++
  }

  abort() {
    this.aborts++
  }

  result(text: string, isFinal: boolean) {
    this.onresult?.({ resultIndex: 0, results: [{ isFinal, 0: { transcript: text } }] })
  }

  error(code: string) {
    this.onerror?.({ error: code })
  }

  end() {
    this.onend?.()
  }
}

beforeEach(() => {
  MockSpeechRecognition.last = null
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined })
  Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: MockSpeechRecognition })
})

afterEach(() => {
  Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: undefined })
  Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined })
})

describe('SpeechToTextButton', () => {
  it('captures Mandarin recognition and emits final text, not interim text', async () => {
    const wrapper = mount(SpeechToTextButton, { props: { contactId: 17 } })
    await wrapper.get('button').trigger('click')
    const speech = MockSpeechRecognition.last!

    expect(speech.lang).toBe('zh-CN')
    expect(speech.continuous).toBe(true)
    expect(speech.interimResults).toBe(true)
    expect(speech.starts).toBe(1)
    expect(wrapper.emitted('listening-start')).toHaveLength(1)

    speech.result('你好', false)
    expect(wrapper.emitted('transcript')).toBeUndefined()

    speech.result('你好', true)
    speech.result('你好', true)
    expect(wrapper.emitted('transcript')).toEqual([['你好', 17]])

    wrapper.unmount()
  })

  it('waits for final recognition results after the stop button is clicked', async () => {
    const wrapper = mount(SpeechToTextButton, { props: { contactId: 17 } })
    await wrapper.get('button').trigger('click')
    const speech = MockSpeechRecognition.last!

    await wrapper.get('button').trigger('click')
    expect(speech.stops).toBe(1)

    speech.result('结束听写', true)
    speech.end()

    expect(wrapper.emitted('transcript')).toEqual([['结束听写', 17]])
    expect(wrapper.get('button').attributes('aria-pressed')).toBe('false')
    wrapper.unmount()
  })

  it('cancels recognition when the recipient changes and ignores late results', async () => {
    const wrapper = mount(SpeechToTextButton, { props: { contactId: 17 } })
    await wrapper.get('button').trigger('click')
    const speech = MockSpeechRecognition.last!
    const oldResultHandler = speech.onresult!

    await wrapper.setProps({ contactId: 18 })
    expect(speech.aborts).toBe(1)
    oldResultHandler({ resultIndex: 0, results: [{ isFinal: true, 0: { transcript: '私密内容' } }] })
    expect(wrapper.emitted('transcript')).toBeUndefined()

    wrapper.unmount()
  })

  it('handles denied microphone permissions and releases recognition', async () => {
    const wrapper = mount(SpeechToTextButton, { props: { contactId: 17 } })
    await wrapper.get('button').trigger('click')
    const speech = MockSpeechRecognition.last!

    speech.error('not-allowed')
    expect(wrapper.emitted('warning')?.[0]?.[0]).toContain('权限')
    expect(speech.aborts).toBe(1)
    wrapper.unmount()
  })

  it('shows an unavailable control when the browser lacks recognition', () => {
    Object.defineProperty(window, 'webkitSpeechRecognition', { configurable: true, value: undefined })
    const wrapper = mount(SpeechToTextButton, { props: { contactId: 17 } })

    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button').attributes('title')).toContain('不支持')
    wrapper.unmount()
  })

  it('aborts on unmount without emitting a transcript', async () => {
    const wrapper = mount(SpeechToTextButton, { props: { contactId: 17 } })
    await wrapper.get('button').trigger('click')
    const speech = MockSpeechRecognition.last!

    wrapper.unmount()

    expect(speech.aborts).toBe(1)
    expect(wrapper.emitted('transcript')).toBeUndefined()
  })
})
