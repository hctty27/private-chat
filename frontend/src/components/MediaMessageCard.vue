<template>
  <div class="media-message-card" :class="mediaClass">
    <button
      v-if="message.msgType === 2"
      class="image-card"
      type="button"
      :disabled="!message.fileUrl || imageFailed"
      aria-label="查看图片"
      @click.stop="openImage"
    >
      <span class="image-shell">
        <img
          v-if="message.fileUrl && !imageFailed"
          :src="imageSrc"
          :loading="lazyImage ? 'lazy' : undefined"
          decoding="async"
          :class="{ loaded: imageLoaded }"
          alt=""
          @load="onImageLoad"
          @error="onImageError"
        />
        <span v-if="!imageLoaded || imageFailed" class="media-placeholder image-placeholder" aria-hidden="true">
          <span v-if="imageFailed">图片加载失败</span>
          <span v-else-if="!message.fileUrl">图片</span>
        </span>
      </span>
    </button>

    <VideoMessageCard
      v-else-if="message.msgType === 5 && message.fileUrl"
      :poster-url="posterUrl"
      :file-name="message.fileName"
      @open="openVideo"
    />

    <button
      v-else-if="message.msgType === 5"
      class="video-pending"
      type="button"
      disabled
      aria-label="视频准备中"
    >
      <span class="video-pending-icon" aria-hidden="true"></span>
    </button>

    <AudioMessageCard
      v-else-if="message.msgType === 6 && message.fileUrl"
      :url="message.fileUrl"
      :file-name="message.fileName"
      :tap-delay-ms="voiceTapDelayMs"
      :suppress-playback-until="suppressVoicePlaybackUntil"
    />

    <div v-else-if="message.msgType === 6" class="audio-pending" aria-label="语音准备中">
      <span class="audio-pending-icon" aria-hidden="true">▶</span>
      <span class="audio-pending-wave" aria-hidden="true">
        <i v-for="n in 10" :key="n"></i>
      </span>
      <span class="audio-pending-label">语音</span>
    </div>

    <div v-if="hasInlineStatus" class="transfer-state" :class="transferStateClass">
      <div class="transfer-copy">
        <span>{{ transferLabel }}</span>
        <span v-if="message.localStatus === 'uploading'" class="transfer-percent">{{ normalizedProgress }}%</span>
      </div>
      <div v-if="message.localStatus === 'uploading'" class="transfer-progress" aria-hidden="true">
        <span :style="{ width: normalizedProgress + '%' }"></span>
      </div>
      <button
        v-if="message.localStatus === 'failed' || message.localStatus === 'cancelled'"
        class="transfer-action"
        type="button"
        @click.stop="emit('retry')"
      >
        重试
      </button>
      <button
        v-else-if="message.localStatus === 'upload_queued' || message.localStatus === 'uploading'"
        class="transfer-action"
        type="button"
        @click.stop="emit('cancel')"
      >
        取消
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import AudioMessageCard from './AudioMessageCard.vue'
import VideoMessageCard from './VideoMessageCard.vue'
import type { Message } from '../types'

const props = withDefaults(defineProps<{
  message: Message
  lazyImage?: boolean
  voiceTapDelayMs?: number
  suppressVoicePlaybackUntil?: number
}>(), {
  lazyImage: true,
  voiceTapDelayMs: 0,
  suppressVoicePlaybackUntil: 0,
})

const emit = defineEmits<{
  open: [event: MouseEvent, type: 'image' | 'video', url: string, posterUrl: string]
  retry: []
  cancel: []
}>()

const imageLoaded = ref(false)
const imageFailed = ref(false)
const fallbackOriginal = ref(false)

const posterUrl = computed(() => (
  props.message.fileId ? `/api/files/${props.message.fileId}/thumbnail` : ''
))

const imageSrc = computed(() => {
  if (!props.message.fileUrl) return ''
  if (fallbackOriginal.value || !props.message.fileId) return props.message.fileUrl
  return `/api/files/${props.message.fileId}/thumbnail`
})

const normalizedProgress = computed(() => {
  const value = props.message.uploadProgress ?? 0
  return Math.min(100, Math.max(0, Math.round(value)))
})

const hasInlineStatus = computed(() => (
  props.message.localStatus === 'upload_queued'
  || props.message.localStatus === 'uploading'
  || props.message.localStatus === 'failed'
  || props.message.localStatus === 'cancelled'
))

const transferLabel = computed(() => {
  if (props.message.localStatus === 'upload_queued') return '等待上传'
  if (props.message.localStatus === 'uploading') return '上传中'
  if (props.message.localStatus === 'cancelled') return '已取消'
  if (props.message.localStatus === 'failed') {
    return props.message.fileUrl ? '发送失败' : '上传失败'
  }
  return ''
})

const transferStateClass = computed(() => ({
  failed: props.message.localStatus === 'failed',
  cancelled: props.message.localStatus === 'cancelled',
}))

const mediaClass = computed(() => ({
  image: props.message.msgType === 2,
  video: props.message.msgType === 5,
  audio: props.message.msgType === 6,
}))

function openImage(event: MouseEvent) {
  if (!props.message.fileUrl || imageFailed.value) return
  emit('open', event, 'image', props.message.fileUrl, '')
}

function openVideo(event: MouseEvent) {
  if (!props.message.fileUrl) return
  emit('open', event, 'video', props.message.fileUrl, posterUrl.value)
}

function onImageLoad() {
  imageLoaded.value = true
  imageFailed.value = false
}

function onImageError() {
  if (!fallbackOriginal.value && props.message.fileId && props.message.fileUrl) {
    fallbackOriginal.value = true
    imageLoaded.value = false
    return
  }
  imageLoaded.value = false
  imageFailed.value = true
}

watch(
  () => [props.message.fileId, props.message.fileUrl],
  () => {
    imageLoaded.value = false
    imageFailed.value = false
    fallbackOriginal.value = false
  }
)
</script>

<style scoped>
.media-message-card {
  position: relative;
  width: max-content;
  max-width: 100%;
  overflow: hidden;
  border-radius: 12px;
  -webkit-tap-highlight-color: transparent;
}

.image-card,
.video-pending {
  display: block;
  width: min(220px, 60vw);
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 12px;
  background: #151515;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.image-card:disabled,
.video-pending:disabled {
  cursor: default;
}

.image-shell {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  overflow: hidden;
  background: #e8e8e8;
}

.image-shell::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.08);
  pointer-events: none;
}

.image-shell img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
  opacity: 0;
  transition: opacity 120ms ease;
}

.image-shell img.loaded {
  opacity: 1;
}

.media-placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 50% 42%, rgba(255,255,255,0.72), transparent 34%),
    linear-gradient(145deg, #ededed, #d9d9d9);
  color: #8e8e93;
  font-size: 12px;
}

.video-pending {
  position: relative;
  aspect-ratio: 16 / 9;
  background:
    radial-gradient(circle at 50% 45%, rgba(255,255,255,0.08), transparent 34%),
    linear-gradient(145deg, #2d2d2d, #151515);
}

.video-pending::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  pointer-events: none;
}

.video-pending-icon {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 46px;
  height: 46px;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.5);
}

.video-pending-icon::after {
  content: '';
  position: absolute;
  left: 19px;
  top: 14px;
  width: 0;
  height: 0;
  border-top: 9px solid transparent;
  border-bottom: 9px solid transparent;
  border-left: 14px solid rgba(255,255,255,0.82);
}

.audio-pending {
  width: 154px;
  height: 42px;
  display: flex;
  align-items: center;
  gap: 8px;
  box-sizing: border-box;
  color: inherit;
}

.audio-pending-icon {
  width: 18px;
  flex: 0 0 18px;
  font-size: 13px;
  text-align: center;
  opacity: 0.72;
}

.audio-pending-wave {
  flex: 1;
  height: 20px;
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0.55;
}

.audio-pending-wave i {
  width: 2px;
  height: 7px;
  border-radius: 2px;
  background: currentColor;
}

.audio-pending-wave i:nth-child(2n) { height: 12px; }
.audio-pending-wave i:nth-child(3n) { height: 16px; }
.audio-pending-wave i:nth-child(5n) { height: 9px; }

.audio-pending-label {
  flex: 0 0 auto;
  font-size: 12px;
  opacity: 0.6;
}

.transfer-state {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 7px;
  padding: 8px;
  box-sizing: border-box;
  border-radius: inherit;
  background: rgba(0, 0, 0, 0.52);
  color: #fff;
  font-size: 12px;
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}

.media-message-card.audio .transfer-state {
  flex-direction: row;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 10px;
}

.transfer-copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.transfer-percent {
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
}

.transfer-progress {
  width: min(120px, 72%);
  height: 3px;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255,255,255,0.24);
}

.transfer-progress span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: rgba(255,255,255,0.92);
  transition: width 160ms ease;
}

.media-message-card.audio .transfer-progress {
  display: none;
}

.transfer-action {
  min-height: 28px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: rgba(255,255,255,0.92);
  color: #333;
  font-size: 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.media-message-card.audio .transfer-action {
  min-height: 26px;
  padding: 0 8px;
}

.transfer-state.failed {
  background: rgba(120, 24, 24, 0.72);
}

.transfer-state.cancelled {
  background: rgba(45, 45, 45, 0.62);
}

@media (max-width: 767px) {
  .image-card,
  .video-pending {
    width: min(68vw, 240px, 56dvh);
  }

  .audio-pending {
    height: 44px;
  }
}
</style>
