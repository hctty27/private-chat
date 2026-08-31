import { describe, expect, it } from 'vitest'
import chatPageSource from './ChatPage.vue?raw'
import mobileChatSource from './MobileChat.vue?raw'
import mediaMessageSource from '../components/MediaMessageCard.vue?raw'
import videoMessageSource from '../components/VideoMessageCard.vue?raw'

describe('chat media loading', () => {
  it('renders desktop and mobile rich media through one shared component', () => {
    for (const source of [chatPageSource, mobileChatSource]) {
      expect(source).toContain("import MediaMessageCard from '../components/MediaMessageCard.vue'")
      expect(source).toContain('v-else-if="isRichMediaMessage(message)"')
      expect(source).toContain(":class=\"[bubbleType(message), { 'visual-media': isStandaloneVisualMedia(message) }]\"")
      expect(source).not.toContain('class="pic-shell"')
      expect(source).not.toContain('<VideoMessageCard')
      expect(source).not.toContain('<AudioMessageCard')
    }
  })

  it('reserves image space before loading and falls back from thumbnail to original', () => {
    expect(mediaMessageSource).toContain('aspect-ratio: 4 / 3')
    expect(mediaMessageSource).toContain('object-fit: contain')
    expect(mediaMessageSource).toContain(':src="imageSrc"')
    expect(mediaMessageSource).toContain('fallbackOriginal.value = true')
    expect(mediaMessageSource).toContain('imageFailed.value = true')
    expect(mediaMessageSource).toContain(':class="{ loaded: imageLoaded }"')
  })

  it('keeps desktop image lazy loading while avoiding native lazy loading on mobile chat', () => {
    expect(chatPageSource).toContain(':lazy-image="true"')
    expect(mobileChatSource).toContain(':lazy-image="false"')
    expect(mediaMessageSource).toContain(':loading="lazyImage ? \'lazy\' : undefined"')
  })

  it('keeps video card height stable while posters load', () => {
    expect(videoMessageSource).toContain('aspect-ratio: 16 / 9')
    expect(videoMessageSource).toContain('object-fit: cover')
    expect(videoMessageSource).not.toContain('video-meta')
    expect(mediaMessageSource).toContain('class="video-pending"')
    expect(mediaMessageSource).toContain('aspect-ratio: 16 / 9')
  })

  it('keeps transfer state inside the reserved media card', () => {
    expect(mediaMessageSource).toContain('class="transfer-state"')
    expect(mediaMessageSource).toContain('position: absolute')
    expect(mediaMessageSource).toContain('inset: 0')
    expect(mediaMessageSource).toContain("message.localStatus === 'uploading'")
    for (const source of [chatPageSource, mobileChatSource]) {
      expect(source).toContain('!hasInlineMediaStatus(message)')
    }
  })
})
