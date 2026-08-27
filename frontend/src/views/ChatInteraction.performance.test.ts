import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const chatPageSource = readFileSync(resolve(process.cwd(), 'src/views/ChatPage.vue'), 'utf8')
const mobileChatSource = readFileSync(resolve(process.cwd(), 'src/views/MobileChat.vue'), 'utf8')
const chatScrollSource = readFileSync(resolve(process.cwd(), 'src/composables/useChatScroll.ts'), 'utf8')

describe('chat interaction performance guards', () => {
  it('computes the last self message once instead of scanning the tail for every row', () => {
    for (const source of [chatPageSource, mobileChatSource]) {
      expect(source).toContain('const lastSelfMessageIndex = computed(() => {')
      expect(source).toContain('return index === lastSelfMessageIndex.value')
      expect(source).not.toContain('chatStore.messages.slice(index + 1).some')
    }
  })

  it('stops batch uploads from repeatedly smooth-scrolling the conversation', () => {
    for (const source of [chatPageSource, mobileChatSource]) {
      expect(source).toContain('let followBatch = scroll.isNearBottom(160)')
      expect(source).toContain('if (followBatch) scroll.scrollToBottomAndClear(false)')
      expect(source).toContain('if (followBatch && !scroll.isNearBottom(320)) followBatch = false')
    }
  })

  it('guards desktop scroll restoration against stale contact selections', () => {
    expect(chatPageSource).toContain('let selectionSeq = 0')
    expect(chatPageSource).toContain('const seq = ++selectionSeq')
    expect(chatPageSource).toContain('if (seq !== selectionSeq || chatStore.currentContact?.userId !== id) return')
  })

  it('keeps mobile connection status out of chat layout flow', () => {
    expect(mobileChatSource).toContain('class="connection-notice-layer"')
    expect(mobileChatSource).toMatch(/\.connection-notice-layer\s*\{[^}]*height:\s*0[^}]*flex:\s*0 0 0/s)
    expect(mobileChatSource).toMatch(/\.connection-notice-layer :deep\(\.connection-notice\)\s*\{[^}]*position:\s*absolute/s)
  })

  it('positions the mobile new-message control from the measured composer height', () => {
    expect(mobileChatSource).toContain('const composerHeight = ref(70)')
    expect(mobileChatSource).toContain('new ResizeObserver(syncComposerHeight)')
    expect(mobileChatSource).toContain("'--composer-height': \`${composerHeight.value}px\`")
    expect(mobileChatSource).toContain(':visible="scroll.showBottomButton.value && !emojiOpen"')
    expect(mobileChatSource).toContain('bottom: calc(var(--composer-height, 70px) + 12px)')
  })

  it('uses asynchronous visibility observation for native mobile message rows', () => {
    expect(chatScrollSource).toContain('new IntersectionObserver((entries) => {')
    expect(chatScrollSource).toContain('visibleMessageIds')
    expect(chatScrollSource).toContain('messageObserver.observe(item)')
  })
})
