import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const mainCssSource = readFileSync(resolve(process.cwd(), 'src/assets/main.css'), 'utf8')
const mobileChatSource = readFileSync(resolve(process.cwd(), 'src/views/MobileChat.vue'), 'utf8')

describe('MobileChat iOS viewport layout', () => {
  it('overrides the mobile document fixed-position lock', () => {
    expect(mainCssSource).toContain('position: static !important')
  })

  it('uses dynamic viewport sizing and horizontal safe-area padding', () => {
    expect(mainCssSource).toContain('100dvh')
    expect(mainCssSource).toContain('env(safe-area-inset-left)')
    expect(mainCssSource).toContain('env(safe-area-inset-right)')
  })

  it('compensates when iOS pans the visual viewport above the keyboard', () => {
    expect(mobileChatSource).toContain('const viewportTop = ref(0)')
    expect(mobileChatSource).toContain('vv.pageTop - window.scrollY')
    expect(mobileChatSource).toContain('vv.offsetTop')
    expect(mobileChatSource).toContain('transform: `translateY(${viewportTop.value}px)`')
  })

  it('resamples the viewport during the iOS keyboard transition', () => {
    expect(mobileChatSource).toContain('requestAnimationFrame(updateViewport)')
    expect(mobileChatSource).toContain('window.setTimeout(updateViewport, 50)')
    expect(mobileChatSource).toContain('window.setTimeout(updateViewport, 250)')
  })
})

describe('MobileChat iOS visual polish', () => {
  it('centers the chat identity in a balanced navigation bar', () => {
    expect(mobileChatSource).toContain('class="chat-head-spacer"')
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
