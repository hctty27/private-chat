import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const chatPage = readFileSync(new URL('../src/views/ChatPage.vue', import.meta.url), 'utf8')

function imageMessageTemplate(source) {
  const marker = 'msgType === 2 && chatStore.messages[vi.index].fileUrl'
  const start = source.indexOf(marker)
  assert.notEqual(start, -1, 'image message template must exist')
  const end = source.indexOf('</template>', start)
  assert.notEqual(end, -1, 'image message template must be closed')
  return source.slice(start, end)
}

test('chat image uses thumbnail URL and deferred decoding', () => {
  const template = imageMessageTemplate(chatPage)

  assert.match(template, /:src="thumbnailUrl\(/)
  assert.match(template, /loading="lazy"/)
  assert.match(template, /decoding="async"/)
})
