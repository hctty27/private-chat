import { describe, expect, it } from 'vitest'
import chatPageSource from './ChatPage.vue?raw'
import mobileChatSource from './MobileChat.vue?raw'

describe('text message whitespace', () => {
  it('preserves explicit line breaks on desktop and mobile', () => {
    for (const source of [chatPageSource, mobileChatSource]) {
      expect(source).toContain('<span class="message-text">{{ message.content }}</span>')
      expect(source).toContain('white-space: pre-wrap')
      expect(source).toContain('overflow-wrap: anywhere')
      expect(source).toContain('word-break: break-word')
    }
  })
})
