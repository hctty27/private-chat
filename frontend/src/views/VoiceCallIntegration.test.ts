import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const desktop = readFileSync(resolve(process.cwd(), 'src/views/ChatPage.vue'), 'utf8')
const mobile = readFileSync(resolve(process.cwd(), 'src/views/MobileChat.vue'), 'utf8')
const callStore = readFileSync(resolve(process.cwd(), 'src/stores/call.ts'), 'utf8')

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

  it('loads call overlays and WebRTC runtime only when needed', () => {
    for (const source of [desktop, mobile]) {
      expect(source).toContain("defineAsyncComponent(() => import('../components/IncomingCallOverlay.vue'))")
      expect(source).toContain("defineAsyncComponent(() => import('../components/VoiceCallOverlay.vue'))")
      expect(source).not.toContain("import VoiceCallOverlay from '../components/VoiceCallOverlay.vue'")
      expect(source).not.toContain("import IncomingCallOverlay from '../components/IncomingCallOverlay.vue'")
    }

    expect(callStore).toContain("import('../composables/useWebRtcCall')")
    expect(callStore).not.toMatch(/import\s*\{[^}]*useWebRtcCall[^}]*\}\s*from\s*['"]\.\.\/composables\/useWebRtcCall['"]/)
    expect(callStore).toContain("if (prepareSeq !== outgoingPrepareSeq || phase.value !== 'preparing') return")
  })

  it('disables call buttons unless websocket is fully connected', () => {
    for (const source of [desktop, mobile]) {
      expect(source).toContain("chatStore.wsStatus !== 'connected'")
    }
  })

  it('cleans call state before logout on both layouts', () => {
    for (const source of [desktop, mobile]) {
      expect(source).toContain('function stopCallBeforeLogout()')
      expect(source).toContain('callStore.dispose()')
    }
  })
})
