import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const scrollSource = readFileSync(resolve(root, 'src/composables/useChatScroll.ts'), 'utf8')
const desktopSource = readFileSync(resolve(root, 'src/views/ChatPage.vue'), 'utf8')
const mobileSource = readFileSync(resolve(root, 'src/views/MobileChat.vue'), 'utf8')
const viteSource = readFileSync(resolve(root, 'vite.config.ts'), 'utf8')

describe('frontend dependency hygiene', () => {
  it('keeps the removed TanStack virtualizer out of runtime dependencies', () => {
    expect(packageJson.dependencies?.['@tanstack/vue-virtual']).toBeUndefined()
    expect(scrollSource).not.toContain('@tanstack/vue-virtual')
    expect(scrollSource).not.toContain('useVirtualizer')
    expect(scrollSource).not.toContain('virtualizer')
    expect(viteSource).not.toContain('tanstack-vendor')
  })

  it('keeps both chat layouts on the native DOM scroll path', () => {
    for (const source of [desktopSource, mobileSource]) {
      expect(source).toContain('useChatScroll(listEl, uid)')
      expect(source).not.toContain('virtualized:')
    }
  })
})
