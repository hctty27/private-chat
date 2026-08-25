import { describe, expect, it } from 'vitest'
import chatPageSource from './ChatPage.vue?raw'

function imageMessageTemplate(source: string) {
  const marker = 'msgType === 2 && chatStore.messages[vi.index].fileUrl'
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf('</template>', start)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('ChatPage image loading', () => {
  it('uses thumbnail URL and deferred decoding for chat images', () => {
    const template = imageMessageTemplate(chatPageSource)

    expect(template).toMatch(/:src="thumbnailUrl\(/)
    expect(template).toContain('loading="lazy"')
    expect(template).toContain('decoding="async"')
  })
})
