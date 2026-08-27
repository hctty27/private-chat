<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="media-overlay" @click.self="close">
        <button class="media-close tap-target" type="button" aria-label="关闭预览" @click.stop="close">×</button>

        <img
          v-if="type === 'image' && !imageError"
          :src="url"
          class="media-content media-img"
          @click="close"
          @load="onImageLoad"
          @error="onImageError"
        />

        <video
          v-else-if="type === 'video'"
          ref="videoEl"
          :src="url"
          :poster="posterUrl || undefined"
          class="media-content media-video"
          controls
          playsinline
          webkit-playsinline
          preload="metadata"
          @loadedmetadata="videoError = false"
          @error="videoError = true"
          @click.stop
        />

        <div v-if="type === 'image' && !loaded && !imageError" class="loading">加载中...</div>
        <div v-if="type === 'image' && imageError" class="loading error">图片加载失败</div>
        <div v-if="type === 'video' && videoError" class="loading error">视频加载失败</div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  url: string
  type: 'image' | 'video'
  posterUrl?: string
}>()

const emit = defineEmits<{ close: [] }>()

const loaded = ref(false)
const imageError = ref(false)
const videoError = ref(false)
const videoEl = ref<HTMLVideoElement | null>(null)

function close() {
  emit('close')
}

function resetMediaState() {
  loaded.value = false
  imageError.value = false
  videoError.value = false
}

function onImageLoad() {
  loaded.value = true
  imageError.value = false
}

function onImageError() {
  loaded.value = false
  imageError.value = true
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

watch([() => props.visible, () => props.url, () => props.type], resetMediaState)

watch(() => props.visible, (v) => {
  if (v) {
    document.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
    videoEl.value?.pause()
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
  videoEl.value?.pause()
})
</script>

<style scoped>
.media-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding:
    max(12px, env(safe-area-inset-top))
    max(12px, env(safe-area-inset-right))
    max(12px, env(safe-area-inset-bottom))
    max(12px, env(safe-area-inset-left));
  box-sizing: border-box;
  background: rgba(0, 0, 0, 0.88);
  cursor: pointer;
}

.media-close {
  position: fixed;
  top: max(12px, env(safe-area-inset-top));
  right: max(12px, env(safe-area-inset-right));
  z-index: 1;
  width: 44px;
  height: 44px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 30px;
  line-height: 40px;
  cursor: pointer;
}

.media-close:hover { background: rgba(255, 255, 255, 0.28); }
.media-close:active { transform: scale(0.96); }

.media-content {
  max-width: 100%;
  max-height: calc(100dvh - 24px - env(safe-area-inset-top) - env(safe-area-inset-bottom));
  object-fit: contain;
}

.media-img { border-radius: 4px; }

.media-video {
  width: min(100%, 960px);
  border-radius: 8px;
  background: #000;
  cursor: default;
}

.loading {
  position: absolute;
  color: #aaa;
  font-size: 14px;
}

.error { color: #f5f5f5; }

.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to { opacity: 0; }
</style>
