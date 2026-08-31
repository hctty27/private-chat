<template>
  <button
    class="audio-message"
    type="button"
    :style="{ width: cardWidth }"
    :aria-label="playing ? '暂停语音' : '播放语音'"
    :title="fileName || undefined"
    @click.stop="togglePlayback"
    @pointerdown.stop
  >
    <span class="audio-progress" :style="{ width: progress + '%' }" aria-hidden="true"></span>
    <span class="audio-icon" aria-hidden="true">{{ playing ? 'Ⅱ' : '▶' }}</span>
    <span class="audio-wave" :class="{ playing }" aria-hidden="true">
      <i v-for="n in 12" :key="n"></i>
    </span>
    <span class="audio-duration">{{ durationLabel }}</span>
    <audio
      ref="audioEl"
      :src="url"
      preload="metadata"
      playsinline
      @loadedmetadata="syncDuration"
      @durationchange="syncDuration"
      @timeupdate="syncProgress"
      @play="playing = true"
      @pause="playing = false"
      @ended="onEnded"
      @error="failed = true"
    ></audio>
  </button>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  url: string
  fileName?: string | null
}>()

const audioEl = ref<HTMLAudioElement | null>(null)
const playing = ref(false)
const failed = ref(false)
const duration = ref(0)
const currentTime = ref(0)
const audioPlayEvent = 'private-chat-audio-play'

const durationLabel = computed(() => {
  if (failed.value) return '无法播放'
  if (!duration.value) return '语音'
  return Math.max(1, Math.round(duration.value)) + '″'
})

const progress = computed(() => {
  if (!duration.value) return 0
  return Math.min(100, Math.max(0, (currentTime.value / duration.value) * 100))
})

const cardWidth = computed(() => {
  const seconds = Math.min(60, Math.max(1, duration.value || 1))
  return Math.round(Math.min(232, 126 + seconds * 1.7)) + 'px'
})

function syncDuration() {
  const value = audioEl.value?.duration
  duration.value = value && Number.isFinite(value) ? value : 0
  failed.value = false
}

function syncProgress() {
  const value = audioEl.value?.currentTime
  currentTime.value = value && Number.isFinite(value) ? value : 0
}

function onEnded() {
  playing.value = false
  currentTime.value = 0
  if (audioEl.value) audioEl.value.currentTime = 0
}

async function togglePlayback() {
  const audio = audioEl.value
  if (!audio || failed.value) return

  if (!audio.paused) {
    audio.pause()
    return
  }

  window.dispatchEvent(new CustomEvent(audioPlayEvent, { detail: audio }))
  try {
    await audio.play()
  } catch {
    failed.value = true
  }
}

function stopForOtherAudio(event: Event) {
  const source = (event as CustomEvent<HTMLAudioElement>).detail
  const audio = audioEl.value
  if (!audio || source === audio || audio.paused) return
  audio.pause()
}

watch(() => props.url, () => {
  playing.value = false
  failed.value = false
  duration.value = 0
  currentTime.value = 0
  audioEl.value?.load()
})

onMounted(() => {
  window.addEventListener(audioPlayEvent, stopForOtherAudio)
})

onBeforeUnmount(() => {
  window.removeEventListener(audioPlayEvent, stopForOtherAudio)
  audioEl.value?.pause()
})
</script>

<style scoped>
.audio-message {
  position: relative;
  min-width: 126px;
  max-width: min(232px, 64vw);
  height: 38px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 2px;
  overflow: hidden;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
  -webkit-tap-highlight-color: transparent;
}
.audio-progress {
  position: absolute;
  inset: 0 auto 0 0;
  background: rgba(0, 0, 0, 0.055);
  pointer-events: none;
}
.audio-icon,
.audio-wave,
.audio-duration {
  position: relative;
  z-index: 1;
}
.audio-icon {
  width: 18px;
  flex: 0 0 18px;
  font-size: 14px;
  line-height: 1;
  text-align: center;
}
.audio-wave {
  flex: 1;
  height: 22px;
  display: flex;
  align-items: center;
  gap: 2px;
}
.audio-wave i {
  width: 2px;
  height: 7px;
  border-radius: 2px;
  background: currentColor;
  opacity: 0.72;
}
.audio-wave i:nth-child(2n) { height: 13px; }
.audio-wave i:nth-child(3n) { height: 18px; }
.audio-wave i:nth-child(5n) { height: 10px; }
.audio-wave.playing i {
  animation: audioPlaying 0.75s ease-in-out infinite alternate;
}
.audio-wave.playing i:nth-child(2n) { animation-delay: 0.12s; }
.audio-wave.playing i:nth-child(3n) { animation-delay: 0.24s; }
.audio-duration {
  flex: 0 0 auto;
  min-width: 27px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  opacity: 0.65;
  text-align: right;
}
audio {
  display: none;
}
@keyframes audioPlaying {
  from { transform: scaleY(0.55); opacity: 0.55; }
  to { transform: scaleY(1); opacity: 0.9; }
}
</style>
