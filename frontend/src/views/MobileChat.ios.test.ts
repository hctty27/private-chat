import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainCssSource = readFileSync(resolve(process.cwd(), 'src/assets/main.css'), 'utf8')
const mobileChatSource = readFileSync(resolve(process.cwd(), 'src/views/MobileChat.vue'), 'utf8')

describe('MobileChat iOS viewport layout', () => {
  it('overrides the mobile document fixed-position lock', () => {
    expect(mainCssSource).toContain('position: static !important')
  })

  it('scopes the document viewport lock to the mobile chat lifecycle', () => {
    expect(mobileChatSource).toContain("const mobileViewportClass = 'mobile-chat-viewport'")
    expect(mobileChatSource).toContain('document.documentElement.classList.add(mobileViewportClass)')
    expect(mobileChatSource).toContain('document.body.classList.add(mobileViewportClass)')
    expect(mobileChatSource).toContain('document.documentElement.classList.remove(mobileViewportClass)')
    expect(mobileChatSource).toContain('document.body.classList.remove(mobileViewportClass)')
    expect(mobileChatSource).toContain('body.mobile-chat-viewport #app')
    expect(mobileChatSource).not.toContain('html, body, #app {')
  })

  it('uses dynamic viewport sizing and horizontal safe-area padding', () => {
    expect(mainCssSource).toContain('100dvh')
    expect(mainCssSource).toContain('env(safe-area-inset-left)')
    expect(mainCssSource).toContain('env(safe-area-inset-right)')
  })

  it('uses the full visual viewport page offset when iOS pans for the keyboard', () => {
    expect(mobileChatSource).toContain('const viewportTop = ref(0)')
    expect(mobileChatSource).toContain('viewportTop.value = vv ? Math.max(0, vv.pageTop) : 0')
    expect(mobileChatSource).not.toContain('vv.pageTop - window.scrollY')
    expect(mobileChatSource).toContain('style.transform = `translateY(${viewportTop.value}px)`')
  })

  it('keeps viewport events geometry-only instead of repeatedly scrolling the conversation', () => {
    expect(mobileChatSource).not.toContain('shouldStickToBottomOnViewportChange')
    expect(mobileChatSource).not.toContain('window.setTimeout(updateViewport')
    expect(mobileChatSource).not.toContain('setTimeout(() => scroll.scrollToBottom')
    expect(mobileChatSource).not.toContain('requestAnimationFrame(() => scroll.scrollToBottom')
  })

  it('restores the latest edge once after the keyboard viewport settles when focus began at the bottom', () => {
    expect(mobileChatSource).toContain('let focusStartedAtEnd = false')
    expect(mobileChatSource).toContain('function schedulePinnedEndSync()')
    expect(mobileChatSource).toContain('const expectedHeight = viewportHeight.value')
    expect(mobileChatSource).toContain('focusStartedAtEnd = scroll.isNearBottom(120)')
    expect(mobileChatSource).toContain('if (heightChanged && inputFocused.value && focusStartedAtEnd) schedulePinnedEndSync()')
    expect(mobileChatSource).toContain('cancelAnimationFrame(pinnedEndFrame)')
  })

  it('keeps the latest edge visible when opening the in-app emoji panel', () => {
    expect(mobileChatSource).toContain('const keepAtEnd = scroll.isNearBottom(160)')
    expect(mobileChatSource).toContain('if (keepAtEnd) scroll.scrollToBottom(false)')
  })

  it('uses native DOM flow for mobile history instead of virtual item positioning', () => {
    expect(mobileChatSource).toContain('v-for="(message, index) in chatStore.messages"')
    expect(mobileChatSource).toContain('class="message-item"')
    expect(mobileChatSource).toContain('useChatScroll(listEl, uid, { virtualized: false })')
    expect(mobileChatSource).toContain('overflow-anchor: none')
    expect(mobileChatSource).not.toContain('scroll.virtualizer.value.getVirtualItems()')
    expect(mobileChatSource).not.toContain('CHAT_SCROLL_MARGIN')
  })
})

describe('MobileChat voice call isolation', () => {
  it('keeps voice call overlays outside the visual viewport chat shell', () => {
    expect(mobileChatSource).toContain('<IncomingCallOverlay')
    expect(mobileChatSource).toContain('<VoiceCallOverlay')
    expect(mobileChatSource).not.toContain("mobileHistory.pushOverlay(contactId, 'call')")
    expect(mobileChatSource).not.toContain("state.overlay === 'call'")
    expect(mobileChatSource).toContain('viewportTop.value = vv ? Math.max(0, vv.pageTop) : 0')
    expect(mobileChatSource).toContain('useChatScroll(listEl, uid, { virtualized: false })')
  })
})

describe('MobileChat message actions', () => {
  it('opens the existing action menu from a touch double tap for every message type', () => {
    expect(mobileChatSource).toContain('const doubleTap = useDoubleTap<Message>((message, point) => {')
    expect(mobileChatSource).toContain('openMessageMenuAt(point.x, point.y, message)')
    expect(mobileChatSource).toContain('function onMessagePointerDown(event: PointerEvent, message: Message) {\n  doubleTap.start(event, message)')
    expect(mobileChatSource).not.toContain('message.msgType !== 1 && message.msgType !== 4')
  })

  it('defers media and file single-tap actions so a double tap can win', () => {
    expect(mobileChatSource).toContain('const clickAt = Date.now()')
    expect(mobileChatSource).toContain('if (suppressNativeClickUntil > clickAt) return')
    expect(mobileChatSource).toContain('}, 340)')
  })
})

describe('MobileChat iOS visual polish', () => {
  it('centers the chat identity in a balanced navigation bar', () => {
    expect(mobileChatSource).toContain('class="mobile-call-button"')
    expect(mobileChatSource).toMatch(/\.chat-head\s*\{[^}]*grid-template-columns:\s*44px minmax\(0, 1fr\) 44px/s)
    expect(mobileChatSource).toMatch(/\.ch-info\s*\{[^}]*text-align:\s*center/s)
  })

  it('uses a pill-style composer while preserving comfortable touch targets', () => {
    expect(mobileChatSource).toMatch(/\.txt\s*\{[^}]*border-radius:\s*22px/s)
    expect(mobileChatSource).toMatch(/\.sbtn\s*\{[^}]*height:\s*44px[^}]*border-radius:\s*22px/s)
    expect(mobileChatSource).toMatch(/\.ibtn\s*\{[^}]*width:\s*44px[^}]*height:\s*44px[^}]*border-radius:\s*22px/s)
  })

  it('makes bubbles and emoji controls friendlier on narrow iPhone screens', () => {
    expect(mobileChatSource).toMatch(/\.bubble\s*\{[^}]*max-width:\s*78%[^}]*border-radius:\s*18px/s)
    expect(mobileChatSource).toContain('grid-template-columns: repeat(auto-fill, minmax(44px, 1fr))')
    expect(mobileChatSource).toContain('36dvh')
  })
})