import { describe, expect, it } from 'vitest'
import chatPageSource from './ChatPage.vue?raw'
import mobileChatSource from './MobileChat.vue?raw'

function imageMessageTemplate(source: string, messageRef: string) {
  const marker = `msgType === 2 && ${messageRef}.fileUrl`
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('</template>', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

function expectThumbnailAndFallback(source: string, messageRef: string) {
  const template = imageMessageTemplate(source, messageRef)
  expect(template).toContain('/thumbnail')
  expect(template).toContain('.fileId')
  expect(template).toContain('decoding="async"')
  expect(template).toContain('class="pic-shell"')
  expect(template).toContain('@load="onImageLoaded"')
  expect(template).toContain(`@error="fallbackImageToOriginal($event, ${messageRef})"`)
  expect(source).toContain('aspect-ratio: 4 / 3')
  expect(source).toContain('object-fit: contain')
  expect(source).toContain('.pic.loaded { opacity: 1; }')
  return template
}

describe('chat image loading', () => {
  it('reserves desktop image space while keeping lazy loading and protected fallback', () => {
    const template = expectThumbnailAndFallback(chatPageSource, 'message')
    expect(template).toContain('loading="lazy"')
  })

  it('reserves mobile image space without native lazy loading on the native chat flow', () => {
    const template = expectThumbnailAndFallback(mobileChatSource, 'message')
    expect(template).not.toContain('loading="lazy"')
  })
})
