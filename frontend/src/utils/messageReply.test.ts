import { describe, expect, it } from 'vitest'
import { messageReplySummary } from './messageReply'

describe('messageReplySummary', () => {
  it('summarizes text and collapses whitespace', () => {
    expect(messageReplySummary({ msgType: 1, content: 'hello\n  world', fileName: null })).toBe('hello world')
  })

  it('summarizes media messages', () => {
    expect(messageReplySummary({ msgType: 2, content: null, fileName: null })).toBe('[图片]')
    expect(messageReplySummary({ msgType: 5, content: null, fileName: null })).toBe('[视频]')
    expect(messageReplySummary({ msgType: 6, content: null, fileName: null })).toBe('[语音]')
    expect(messageReplySummary({ msgType: 3, content: null, fileName: 'report.pdf' })).toBe('[文件] report.pdf')
  })
})
