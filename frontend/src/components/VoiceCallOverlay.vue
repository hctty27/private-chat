<template>
  <div class="voice-call-overlay" role="dialog" aria-modal="true" aria-label="语音通话">
    <audio ref="remoteAudioEl" autoplay playsinline></audio>

    <div class="call-card">
      <div class="avatar">{{ peerName.slice(0, 1) || '联' }}</div>
      <div class="name">{{ peerName || '联系人' }}</div>
      <div class="status">{{ statusText }}</div>
      <div v-if="error" class="error">{{ error }}</div>

      <button
        v-if="resumeAudioVisible"
        type="button"
        class="resume-audio"
        @click="playRemoteAudio"
      >
        点击恢复声音
      </button>

      <div v-if="showControls" class="controls">
        <button
          v-if="phase === 'connecting' || phase === 'connected'"
          type="button"
          class="control"
          :aria-label="muted ? '取消静音' : '静音'"
          @click="emit('toggle-mute')"
        >
          <span class="control-circle">{{ muted ? '静' : '麦' }}</span>
          <small>{{ muted ? '取消静音' : '静音' }}</small>
        </button>
        <button
          type="button"
          class="control"
          aria-label="挂断语音通话"
          @click="emit('hangup')"
        >
          <span class="control-circle hangup">✕</span>
          <small>{{ phase === 'outgoing' ? '取消' : '挂断' }}</small>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CallPhase } from '../types'

const props = defineProps<{
  phase: CallPhase
  peerName: string
  durationSeconds: number
  muted: boolean
  error: string
  remoteStream: MediaStream | null
}>()

const emit = defineEmits<{
  hangup: []
  'toggle-mute': []
}>()

const remoteAudioEl = ref<HTMLAudioElement | null>(null)
const resumeAudioVisible = ref(false)

const statusText = computed(() => {
  if (props.phase === 'outgoing') return '正在呼叫…'
  if (props.phase === 'connecting') return '正在连接…'
  if (props.phase === 'connected') return formatDuration(props.durationSeconds)
  if (props.phase === 'failed') return '通话失败'
  if (props.phase === 'ended') return '通话已结束'
  return ''
})

const showControls = computed(() =>
  props.phase === 'outgoing' || props.phase === 'connecting' || props.phase === 'connected'
)

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const remainder = safe % 60
  return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0')
}

async function syncRemoteAudio() {
  await nextTick()
  const audio = remoteAudioEl.value
  if (!audio) return
  audio.srcObject = props.remoteStream
  if (!props.remoteStream) {
    resumeAudioVisible.value = false
    return
  }
  try {
    await audio.play()
    resumeAudioVisible.value = false
  } catch {
    resumeAudioVisible.value = true
  }
}

async function playRemoteAudio() {
  const audio = remoteAudioEl.value
  if (!audio) return
  try {
    await audio.play()
    resumeAudioVisible.value = false
  } catch {
    resumeAudioVisible.value = true
  }
}

watch(() => props.remoteStream, () => { void syncRemoteAudio() })
onMounted(() => { void syncRemoteAudio() })
onBeforeUnmount(() => {
  if (remoteAudioEl.value) remoteAudioEl.value.srcObject = null
})
</script>

<style scoped>
.voice-call-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
  box-sizing: border-box;
  background: rgba(24, 24, 27, 0.86);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.voice-call-overlay audio {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.call-card { width: min(380px, 100%); text-align: center; color: #fff; }
.avatar {
  width: 92px;
  height: 92px;
  margin: 0 auto 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255,255,255,0.18);
  font-size: 38px;
  font-weight: 600;
}
.name { font-size: 25px; font-weight: 600; }
.status { margin-top: 9px; min-height: 22px; color: rgba(255,255,255,0.74); font-size: 15px; font-variant-numeric: tabular-nums; }
.error { margin-top: 10px; color: #ffb4ae; font-size: 14px; }
.resume-audio {
  margin-top: 18px;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid rgba(255,255,255,0.28);
  border-radius: 22px;
  background: rgba(255,255,255,0.12);
  color: #fff;
  cursor: pointer;
}
.controls { min-height: 110px; margin-top: 68px; display: flex; justify-content: center; gap: 52px; }
.control {
  width: 76px;
  border: 0;
  background: transparent;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  cursor: pointer;
}
.control-circle {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(255,255,255,0.18);
  font-size: 18px;
}
.control-circle.hangup { background: #ff3b30; font-size: 25px; }
.control small { font-size: 13px; }
</style>
