<template>
  <Teleport to="body">
    <Transition name="fade">
      <div v-if="visible" class="media-overlay" @click.self="close">
        <button class="close-btn" @click="close">&times;</button>

        <!-- Image -->
        <img
          v-if="type === 'image'"
          :src="url"
          class="media-content media-img"
          :class="{ zoomed }"
          @click="zoomed = !zoomed"
          @load="loaded = true"
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

        <div v-if="!loaded && type === 'image'" class="loading">加载中...</div>
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

const zoomed = ref(false)
const loaded = ref(false)
const videoEl = ref<HTMLVideoElement | null>(null)

function close() {
  emit('close')
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') close()
}

watch(() => props.visible, (v) => {
  zoomed.value = false
  loaded.value = false
  if (v) {
    document.addEventListener('keydown', onKeydown)
    document.body.style.overflow = 'hidden'
    if (props.type === 'video') {
      nextTick(() => { videoEl.value?.play().catch(() => {}) })
    }
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

.close-btn {
  position: absolute;
  top: 16px;
  right: 20px;
  z-index: 10000;
  background: none;
  border: none;
  color: #fff;
  font-size: 36px;
  cursor: pointer;
  line-height: 1;
  opacity: 0.8;
  transition: opacity 0.2s;
}
.close-btn:hover {
  opacity: 1;
}

.media-content {
  max-width: 90vw;
  max-height: 90vh;
  object-fit: contain;
}

.media-img {
  cursor: zoom-in;
  border-radius: 4px;
  transition: transform 0.3s ease;
}
.media-img.zoomed {
  cursor: zoom-out;
  max-width: none;
  max-height: none;
  transform: scale(1);
  width: auto;
  height: auto;
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

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
