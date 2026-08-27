import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const chatPageSource = readFileSync(resolve(process.cwd(), 'src/views/ChatPage.vue'), 'utf8')
const mobileChatSource = readFileSync(resolve(process.cwd(), 'src/views/MobileChat.vue'), 'utf8')
const composerSource = readFileSync(resolve(process.cwd(), 'src/composables/useChatComposer.ts'), 'utf8')

describe('chat composer textarea resizing', () => {
  it('shares the border-box resize implementation between desktop and mobile', () => {
    expect(composerSource).toContain('const borderHeight = input.offsetHeight - input.clientHeight')
    expect(composerSource).toContain('const contentHeight = input.scrollHeight + borderHeight')
    expect(chatPageSource).toContain('maxHeight: 100')
    expect(mobileChatSource).toContain('maxHeight: 108')
  })

  it('only enables vertical scrolling after the configured composer max height', () => {
    expect(composerSource).toContain("input.style.overflowY = contentHeight > options.maxHeight ? 'auto' : 'hidden'")
    expect(chatPageSource).not.toContain('const borderHeight = inputEl.value.offsetHeight - inputEl.value.clientHeight')
    expect(mobileChatSource).not.toContain('const borderHeight = inputEl.value.offsetHeight - inputEl.value.clientHeight')
  })
})
