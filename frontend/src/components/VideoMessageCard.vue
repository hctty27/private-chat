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
      <span class="video-shade" aria-hidden="true"></span>
      <span class="play-button" aria-hidden="true">
        <span class="play-icon"></span>
      </span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  posterUrl?: string | null
  fileName?: string | null
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

.video-poster::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: 3;
  border-radius: inherit;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  pointer-events: none;
}

.video-poster img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
}

.video-placeholder {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 50% 45%, rgba(255,255,255,0.08), transparent 34%),
    linear-gradient(145deg, #2d2d2d, #151515);
}

.video-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(to bottom, rgba(0,0,0,0.04), rgba(0,0,0,0.18));
}

.play-button {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  transform: translate(-50%, -50%);
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.55);
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.play-icon {
  width: 0;
  height: 0;
  margin-left: 4px;
  border-top: 9px solid transparent;
  border-bottom: 9px solid transparent;
  border-left: 14px solid #fff;
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
