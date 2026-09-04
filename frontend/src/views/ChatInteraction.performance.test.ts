import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const chatPageSource = readFileSync(resolve(process.cwd(), 'src/views/ChatPage.vue'), 'utf8')
const mobileChatSource = readFileSync(resolve(process.cwd(), 'src/views/MobileChat.vue'), 'utf8')
const chatScrollSource = readFileSync(resolve(process.cwd(), 'src/composables/useChatScroll.ts'), 'utf8')
const messageUiSource = readFileSync(resolve(process.cwd(), 'src/composables/useChatMessageUi.ts'), 'utf8')
const attachmentsSource = readFileSync(resolve(process.cwd(), 'src/composables/useChatAttachments.ts'), 'utf8')

describe('chat interaction performance guards', () => {
  it('computes the last self message once in shared message presentation logic', () => {
    expect(messageUiSource).toContain('const lastSelfMessageIndex = computed(() => {')
    expect(messageUiSource).toContain('index === lastSelfMessageIndex.value')
    for (const source of [chatPageSource, mobileChatSource]) {
      expect(source).toContain('useChatMessageUi(uid)')
      expect(source).not.toContain('chatStore.messages.slice(index + 1).some')
      expect(source).not.toContain('const lastSelfMessageIndex = computed(() => {')
    }
  })

  it('shares non-blocking background upload behavior between desktop and mobile', () => {
    expect(attachmentsSource).toContain('for (const file of files)')
    expect(attachmentsSource).toContain('chatStore.sendFile(file)')
    expect(attachmentsSource).not.toContain('await chatStore.sendFile')
    expect(attachmentsSource).not.toContain('uploadBusy')
    expect(attachmentsSource).toContain('if (followBatch) options.scroll.scrollToBottomAndClear(false)')
    for (const source of [chatPageSource, mobileChatSource]) {
      expect(source).toContain('useChatAttachments({')
      expect(source).not.toContain(':disabled="uploadBusy"')
      expect(source).not.toContain('v-if="progress > 0 && progress < 100"')
    }
  })

  it('opens explicit conversation selections at the latest message', () => {
    expect(chatPageSource).toContain('let selectionSeq = 0')
    expect(chatPageSource).toContain('const seq = ++selectionSeq')
    expect(chatPageSource).toContain('if (seq !== selectionSeq || chatStore.currentContact?.userId !== id) return')
    expect(chatPageSource).toContain('scroll.onContactChange({ scrollToBottom: true })')
    expect(chatPageSource).not.toContain('scrollMemory')
    expect(chatPageSource).not.toContain('restoreVisibleAnchor')

    expect(mobileChatSource).toContain('async function enterContactAtLatest()')
    expect(mobileChatSource).toContain('scroll.onContactChange({ scrollToBottom: true })')
    expect(mobileChatSource).toContain('await enterContactAtLatest()')
    expect(mobileChatSource).not.toContain('scrollMemory')
    expect(mobileChatSource).not.toContain('restoreContactScroll')
  })

  it('keeps mobile connection status out of chat layout flow', () => {
    expect(mobileChatSource).toContain('class="connection-notice-layer"')
    expect(mobileChatSource).toMatch(/\.connection-notice-layer\s*\{[^}]*height:\s*0[^}]*flex:\s*0 0 0/s)
    expect(mobileChatSource).toMatch(/\.connection-notice-layer :deep\(\.connection-notice\)\s*\{[^}]*position:\s*absolute/s)
  })

  it('positions the mobile new-message control from the measured composer height', () => {
    expect(mobileChatSource).toContain('const composerHeight = ref(70)')
    expect(mobileChatSource).toContain('new ResizeObserver(syncComposerHeight)')
    expect(mobileChatSource).toContain("'--composer-height': `${composerHeight.value}px`")
    expect(mobileChatSource).toContain(':visible="scroll.showBottomButton.value && !emojiOpen"')
    expect(mobileChatSource).toContain('bottom: calc(var(--composer-height, 70px) + 12px)')
  })

  it('keeps the desktop conversation on the native DOM scroll path', () => {
    expect(chatPageSource).toContain('useChatScroll(listEl, uid)')
    expect(chatPageSource).toContain('v-for="(message, index) in chatStore.messages"')
    expect(chatPageSource).toContain('class="message-item"')
    expect(chatPageSource).not.toContain('scroll.virtualizer')
    expect(chatPageSource).not.toContain('class="virtual-list"')
    expect(chatPageSource).not.toContain('class="virtual-item"')
    expect(chatPageSource).not.toContain('CHAT_SCROLL_MARGIN')
  })

  it('keeps desktop message heights fully laid out for reliable bottom scrolling', () => {
    expect(chatPageSource).not.toContain('content-visibility: auto')
    expect(chatPageSource).not.toContain('contain-intrinsic-block-size')
    expect(mobileChatSource).not.toContain('content-visibility: auto')
    expect(mobileChatSource).not.toContain('contain-intrinsic-block-size')
  })

  it('uses asynchronous visibility observation for native mobile message rows', () => {
    expect(chatScrollSource).toContain('new IntersectionObserver((entries) => {')
    expect(chatScrollSource).toContain('visibleMessageIds')
    expect(chatScrollSource).toContain('messageObserver.observe(item)')
  })
})
