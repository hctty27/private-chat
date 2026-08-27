<template>
  <button
    class="video-card"
    type="button"
    :aria-label="`播放视频 ${fileName || ''}`.trim()"
    @click="$emit('open', $event)"
  >
    <span class="video-poster">
      <img
        v-if="posterUrl && !posterError"
        :src="posterUrl"
        alt=""
        loading="lazy"
        decoding="async"
        @error="posterError = true"
      />
      <span v-else class="video-placeholder" aria-hidden="true"></span>
      <span class="play-button" aria-hidden="true">
        <span class="play-icon"></span>
      </span>
    </span>

    <span v-if="fileName || fileSizeText" class="video-meta">
      <span v-if="fileName" class="video-name">{{ fileName }}</span>
      <small v-if="fileSizeText">{{ fileSizeText }}</small>
    </span>
  </button>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  posterUrl?: string | null
  fileName?: string | null
  fileSizeText?: string | null
}>()

defineEmits<{ open: [event: MouseEvent] }>()

const posterError = ref(false)

watch(() => props.posterUrl, () => {
  posterError.value = false
})
</script>

<style scoped>
.video-card {
  display: block;
  width: min(240px, 60vw);
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  border: 0;
  border-radius: 12px;
  background: #111;
  color: inherit;
  text-align: left;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

.video-poster {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  overflow: hidden;
  background: #111;
}

.video-poster img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: contain;
}

.video-placeholder {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 45%, rgba(255,255,255,0.08), transparent 34%),
    linear-gradient(145deg, #2d2d2d, #151515);
}

.play-button {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.58);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(4px);
}

.play-icon {
  width: 0;
  height: 0;
  margin-left: 4px;
  border-top: 9px solid transparent;
  border-bottom: 9px solid transparent;
  border-left: 14px solid #fff;
}

.video-meta {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: rgba(255, 255, 255, 0.96);
}

.video-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: #333;
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.video-meta small {
  flex: 0 0 auto;
  color: #8e8e93;
  font-size: 11px;
}

.video-card:active .play-button {
  transform: translate(-50%, -50%) scale(0.94);
}

@media (max-width: 767px) {
  .video-card {
    width: min(68vw, 240px, 56dvh);
  }
}
</style>
