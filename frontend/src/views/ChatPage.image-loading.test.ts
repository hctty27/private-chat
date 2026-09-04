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

  it('keeps thumbnail failures from automatically downloading the original image', () => {
    expect(mediaMessageSource).toContain('aspect-ratio: 4 / 3')
    expect(mediaMessageSource).toContain('object-fit: contain')
    expect(mediaMessageSource).toContain(':src="imageSrc"')
    expect(mediaMessageSource).not.toContain('fallbackOriginal')
    expect(mediaMessageSource).toContain('imageFailed.value = true')
    expect(mediaMessageSource).toContain('点击查看原图')
    expect(mediaMessageSource).toContain(':disabled="!message.fileUrl"')
    expect(mediaMessageSource).toContain(':class="{ loaded: imageLoaded }"')
  })

  it('eager-loads the recent desktop image tail and keeps older history lazy', () => {
    expect(chatPageSource).toContain(':lazy-image="shouldLazyLoadImage(index)"')
    expect(chatPageSource).toContain('const EAGER_IMAGE_TAIL_COUNT = 8')
    expect(chatPageSource).toContain('index < chatStore.messages.length - EAGER_IMAGE_TAIL_COUNT')
    expect(mobileChatSource).toContain(':lazy-image="false"')
    expect(mediaMessageSource).toContain(':loading="lazyImage ? \'lazy\' : undefined"')
  })

  it('restores already-complete cached images when a media card mounts again', () => {
    expect(mediaMessageSource).toContain('ref="imageEl"')
    expect(mediaMessageSource).toContain('image.complete')
    expect(mediaMessageSource).toContain('image.naturalWidth > 0')
    expect(mediaMessageSource).toContain('onMounted(syncImageState)')
    expect(mediaMessageSource).toContain('watch(imageSrc, async () =>')
    expect(mediaMessageSource).toContain('await nextTick()')
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
