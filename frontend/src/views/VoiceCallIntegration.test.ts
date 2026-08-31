import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktop = readFileSync(resolve(process.cwd(), 'src/views/ChatPage.vue'), 'utf8')
const mobile = readFileSync(resolve(process.cwd(), 'src/views/MobileChat.vue'), 'utf8')

describe('voice call view integration', () => {
  it('mounts call controls on desktop outside the message scroller', () => {
    expect(desktop).toContain('<VoiceCallButton')
    expect(desktop).toContain('<IncomingCallOverlay')
    expect(desktop).toContain('<VoiceCallOverlay')
    expect(desktop.indexOf('<VoiceCallOverlay')).toBeGreaterThan(desktop.indexOf('</main>'))
    expect(desktop).toContain('callStore.ensureBound()')
  })

  it('keeps mobile call overlays outside chat page and mobile history overlays', () => {
    expect(mobile).toContain('class="mobile-call-button"')
    expect(mobile).toContain('<IncomingCallOverlay')
    expect(mobile).toContain('<VoiceCallOverlay')
    expect(mobile).not.toContain("mobileHistory.pushOverlay(contactId, 'call')")
    expect(mobile).not.toContain("state.overlay === 'call'")
    expect(mobile).toContain('grid-template-columns: 44px minmax(0, 1fr) 44px')
  })

  it('cleans call state before logout on both layouts', () => {
    for (const source of [desktop, mobile]) {
      expect(source).toContain('function stopCallBeforeLogout()')
      expect(source).toContain('callStore.dispose()')
    }
  })
})
