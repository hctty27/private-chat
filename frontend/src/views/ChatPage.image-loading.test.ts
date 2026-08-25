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

function expectThumbnailAndFallback(source: string) {
  const template = imageMessageTemplate(source)
  expect(template).toContain('/thumbnail')
  expect(template).toContain('.fileId')
  expect(template).toContain('decoding="async"')
  expect(template).toContain('@error="fallbackImageToOriginal($event, chatStore.messages[vi.index])"')
  return template
}

describe('chat image loading', () => {
  it('keeps lazy loading on desktop and falls back to the protected original', () => {
    const template = expectThumbnailAndFallback(chatPageSource)
    expect(template).toContain('loading="lazy"')
  })

  it('avoids native lazy loading on the virtualized mobile chat and falls back to the protected original', () => {
    const template = expectThumbnailAndFallback(mobileChatSource)
    expect(template).not.toContain('loading="lazy"')
  })
})
