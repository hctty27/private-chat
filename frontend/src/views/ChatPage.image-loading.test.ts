import { describe, expect, it } from 'vitest'
import chatPageSource from './ChatPage.vue?raw'
import mobileChatSource from './MobileChat.vue?raw'

function imageMessageTemplate(source: string) {
  const marker = 'msgType === 2 && chatStore.messages[vi.index].fileUrl'
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('</template>', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function expectOptimizedImageTemplate(source: string) {
  const template = imageMessageTemplate(source)
  expect(template).toMatch(/:src="thumbnailUrl\(chatStore\.messages\[vi\.index\]\)"/)
  expect(template).toContain('loading="lazy"')
  expect(template).toContain('decoding="async"')
}

describe('chat image loading', () => {
  it('uses thumbnail URL and deferred decoding on desktop', () => {
    expectOptimizedImageTemplate(chatPageSource)
  })

  it('uses thumbnail URL and deferred decoding on mobile', () => {
    expectOptimizedImageTemplate(mobileChatSource)
  })
})
