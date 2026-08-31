import { describe, expect, it } from 'vitest'
import chatPageSource from './ChatPage.vue?raw'
import mobileChatSource from './MobileChat.vue?raw'
import mediaMessageSource from '../components/MediaMessageCard.vue?raw'
import videoMessageSource from '../components/VideoMessageCard.vue?raw'
import audioMessageSource from '../components/AudioMessageCard.vue?raw'

describe('chat media loading', () => {
  it('renders desktop and mobile rich media through one shared component', () => {
    for (const source of [chatPageSource, mobileChatSource]) {
      expect(source).toContain("import MediaMessageCard from '../components/MediaMessageCard.vue'")
      expect(source).toContain('v-else-if="isRichMediaMessage(message)"')
      expect(source).toContain("'voice-media': isStandaloneVoiceMessage(message)")
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

  it('adds subtle media frames without changing reserved dimensions', () => {
    expect(mediaMessageSource).toContain('box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08)')
    expect(videoMessageSource).toContain('box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12)')
    expect(mediaMessageSource).toContain('.video-pending::after')
  })

  it('keeps standalone voice bubbles compact with a 44px mobile target', () => {
    expect(audioMessageSource).toContain('height: 42px')
    expect(audioMessageSource).toContain('height: 44px')
    expect(audioMessageSource).toContain('height: 18px')
    expect(mediaMessageSource).toContain('.audio-pending')
    expect(mediaMessageSource).toContain('height: 44px')
    for (const source of [chatPageSource, mobileChatSource]) {
      expect(source).toContain("'voice-media': isStandaloneVoiceMessage(message)")
      expect(source).toContain('.bubble.voice-media')
    }
  })
})
