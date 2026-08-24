import { describe, expect, it } from 'vitest'
import mobileChatSource from './MobileChat.vue?raw'

describe('MobileChat iOS viewport layout', () => {
  it('does not hard-lock the document with position fixed', () => {
    expect(mobileChatSource).not.toContain('position: fixed')
  })

  it('uses dynamic viewport sizing and horizontal safe-area padding', () => {
    expect(mobileChatSource).toContain('100dvh')
    expect(mobileChatSource).toContain('env(safe-area-inset-left)')
    expect(mobileChatSource).toContain('env(safe-area-inset-right)')
  })
})
