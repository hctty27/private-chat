<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="media-overlay" @click.self="close">
        <button class="media-close" type="button" aria-label="关闭预览" @click.stop="close">×</button>

        <!-- Image -->
        <img
          v-if="type === 'image' && !imageError"
          :src="url"
          class="media-content media-img"
          @click="close"
          @load="onImageLoad"
          @error="onImageError"
        />

        <!-- Video -->
        <video
          v-else-if="type === 'video'"
          ref="videoEl"
          :src="url"
          class="media-content media-video"
          controls
          playsinline
          webkit-playsinline
          preload="auto"
          @click.stop
        />

        <div v-if="type === 'image' && !loaded && !imageError" class="loading">加载中...</div>
        <div v-if="type === 'image' && imageError" class="loading error">图片加载失败</div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch, onUnmounted, nextTick } from 'vue'

const props = defineProps<{
  visible: boolean
  url: string
  type: 'image' | 'video'
}>()

const emit = defineEmits<{ close: [] }>()

const loaded = ref(false)
const imageError = ref(false)
const videoEl = ref<HTMLVideoElement | null>(null)

function close() {
  emit('close')
}

function resetMediaState() {
  loaded.value = false
  imageError.value = false
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

watch([() => props.visible, () => props.url, () => props.type], () => {
  resetMediaState()
  if (props.visible && props.type === 'video') {
    nextTick(() => { videoEl.value?.play().catch(() => {}) })
  }
})

watch(() => props.visible, (v) => {
  if (v) {
    document.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
  } else {
    document.removeEventListener('keydown', onKeydown)
    document.body.style.overflow = ''
    if (videoEl.value) {
      videoEl.value.pause()
    }
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<style scoped>
.media-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.media-close {
  position: fixed;
  top: 16px;
  right: 18px;
  z-index: 1;
  width: 40px;
  height: 40px;
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
  font-size: 30px;
  line-height: 36px;
  cursor: pointer;
}

.media-close:hover {
  background: rgba(255, 255, 255, 0.28);
}

.media-content {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
}

.media-img {
  border-radius: 4px;
}

.media-video {
  border-radius: 8px;
  background: #000;
  cursor: default;
}

.loading {
  position: absolute;
  color: #aaa;
  font-size: 14px;
}

.error {
  color: #f5f5f5;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
