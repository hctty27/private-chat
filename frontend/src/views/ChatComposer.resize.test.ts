import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const chatPageSource = readFileSync(resolve(process.cwd(), 'src/views/ChatPage.vue'), 'utf8')
const mobileChatSource = readFileSync(resolve(process.cwd(), 'src/views/MobileChat.vue'), 'utf8')

describe('chat composer textarea resizing', () => {
  it('accounts for textarea borders when assigning scrollHeight to a border-box height', () => {
    for (const source of [chatPageSource, mobileChatSource]) {
      expect(source).toContain('const borderHeight = inputEl.value.offsetHeight - inputEl.value.clientHeight')
      expect(source).toContain('const contentHeight = inputEl.value.scrollHeight + borderHeight')
    }
  })

  it('only enables vertical scrolling after the composer reaches its max height', () => {
    expect(chatPageSource).toContain("inputEl.value.style.overflowY = contentHeight > 100 ? 'auto' : 'hidden'")
    expect(mobileChatSource).toContain("inputEl.value.style.overflowY = contentHeight > 108 ? 'auto' : 'hidden'")
  })
})
