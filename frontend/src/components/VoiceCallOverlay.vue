<template>
  <div
    class="voice-call-overlay"
    :class="{ video: callStore.callType === 'video' }"
    role="dialog"
    aria-modal="true"
    :aria-label="callStore.callType === 'video' ? '视频通话' : '语音通话'"
  >
    <audio v-if="callStore.callType === 'audio'" ref="remoteAudioEl" autoplay playsinline></audio>

    <template v-if="callStore.callType === 'video'">
      <video
        ref="remoteVideoEl"
        class="remote-video"
        autoplay
        playsinline
      ></video>
      <div v-if="!remoteStream" class="remote-placeholder">
        <div class="avatar">{{ peerName.slice(0, 1) || '联' }}</div>
      </div>
      <video
        v-if="callStore.localStream && !callStore.cameraOff"
        ref="localVideoEl"
        class="local-video"
        autoplay
        playsinline
        muted
      ></video>
    </template>

    <div class="call-card" :class="{ 'video-card': callStore.callType === 'video' }">
      <template v-if="callStore.callType === 'audio'">
        <div class="avatar">{{ peerName.slice(0, 1) || '联' }}</div>
        <div class="name">{{ peerName || '联系人' }}</div>
      </template>
      <div v-else class="video-header">
        <div class="name">{{ peerName || '联系人' }}</div>
      </div>

      <div class="status">{{ statusText }}</div>
      <div v-if="error" class="error">{{ error }}</div>

      <button
        v-if="resumeAudioVisible"
        type="button"
        class="resume-audio"
        @click="playRemoteMedia"
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
          v-if="callStore.callType === 'video' && (phase === 'connecting' || phase === 'connected')"
          type="button"
          class="control"
          :aria-label="callStore.cameraOff ? '打开摄像头' : '关闭摄像头'"
          @click="callStore.toggleCamera"
        >
          <span class="control-circle">{{ callStore.cameraOff ? '关' : '像' }}</span>
          <small>{{ callStore.cameraOff ? '打开摄像头' : '关闭摄像头' }}</small>
        </button>

        <button
          v-if="callStore.callType === 'video' && !callStore.cameraOff && (phase === 'connecting' || phase === 'connected')"
          type="button"
          class="control"
          aria-label="切换摄像头"
          @click="callStore.switchCamera"
        >
          <span class="control-circle">↻</span>
          <small>切换镜头</small>
        </button>

        <button
          type="button"
          class="control"
          :aria-label="callStore.callType === 'video' ? '挂断视频通话' : '挂断语音通话'"
          @click="emit('hangup')"
        >
          <span class="control-circle hangup">✕</span>
          <small>{{ phase === 'preparing' || phase === 'outgoing' ? '取消' : '挂断' }}</small>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CallPhase } from '../types'
import { useCallStore } from '../stores/call'

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

const callStore = useCallStore()
const remoteAudioEl = ref<HTMLAudioElement | null>(null)
const remoteVideoEl = ref<HTMLVideoElement | null>(null)
const localVideoEl = ref<HTMLVideoElement | null>(null)
const resumeAudioVisible = ref(false)

const statusText = computed(() => {
  if (props.phase === 'preparing') return '正在准备通话…'
  if (props.phase === 'outgoing') return '正在呼叫…'
  if (props.phase === 'connecting') return '正在连接…'
  if (props.phase === 'connected') return formatDuration(props.durationSeconds)
  if (props.phase === 'failed') return '通话失败'
  if (props.phase === 'ended') return '通话已结束'
  return ''
})

const showControls = computed(() =>
  props.phase === 'preparing' || props.phase === 'outgoing' || props.phase === 'connecting' || props.phase === 'connected'
)

function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(safe / 60)
  const remainder = safe % 60
  return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0')
}

async function syncMedia() {
  await nextTick()

  const remote = callStore.callType === 'video' ? remoteVideoEl.value : remoteAudioEl.value
  if (remote) {
    remote.srcObject = props.remoteStream
    if (!props.remoteStream) {
      resumeAudioVisible.value = false
    } else {
      try {
        await remote.play()
        resumeAudioVisible.value = false
      } catch {
        resumeAudioVisible.value = true
      }
    }
  }

  const local = localVideoEl.value
  if (local) {
    local.srcObject = callStore.localStream
    if (callStore.localStream) {
      try {
        await local.play()
      } catch {
        // Local preview is muted; failure is non-fatal and the stream remains attached.
      }
    }
  }
}

async function playRemoteMedia() {
  const remote = callStore.callType === 'video' ? remoteVideoEl.value : remoteAudioEl.value
  if (!remote) return
  try {
    await remote.play()
    resumeAudioVisible.value = false
  } catch {
    resumeAudioVisible.value = true
  }
}

watch(
  () => [props.remoteStream, callStore.localStream, callStore.callType, callStore.cameraOff],
  () => { void syncMedia() },
)
onMounted(() => { void syncMedia() })
onBeforeUnmount(() => {
  if (remoteAudioEl.value) remoteAudioEl.value.srcObject = null
  if (remoteVideoEl.value) remoteVideoEl.value.srcObject = null
  if (localVideoEl.value) localVideoEl.value.srcObject = null
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
.voice-call-overlay.video {
  padding: 0;
  overflow: hidden;
  background: #111;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
.voice-call-overlay audio {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}
.remote-video,
.remote-placeholder {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.remote-video {
  object-fit: cover;
  background: #111;
}
.remote-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle at center, #36363b, #161618 68%);
}
.local-video {
  position: absolute;
  z-index: 2;
  top: max(18px, env(safe-area-inset-top));
  right: max(14px, env(safe-area-inset-right));
  width: min(28vw, 170px);
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 16px;
  background: #222;
  box-shadow: 0 8px 30px rgba(0,0,0,0.35);
  transform: scaleX(-1);
}
.call-card { width: min(380px, 100%); text-align: center; color: #fff; }
.call-card.video-card {
  position: relative;
  z-index: 3;
  width: 100%;
  height: 100%;
  padding: max(24px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
  background: linear-gradient(to bottom, rgba(0,0,0,0.42), transparent 22%, transparent 64%, rgba(0,0,0,0.58));
}
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
.remote-placeholder .avatar { margin: 0; }
.name { font-size: 25px; font-weight: 600; }
.video-header { margin-top: 4px; pointer-events: none; }
.video-header .name {
  font-size: 20px;
  text-shadow: 0 1px 6px rgba(0,0,0,0.5);
}
.status {
  margin-top: 9px;
  min-height: 22px;
  color: rgba(255,255,255,0.74);
  font-size: 15px;
  font-variant-numeric: tabular-nums;
}
.video-card .status {
  margin-top: 5px;
  color: rgba(255,255,255,0.9);
  text-shadow: 0 1px 5px rgba(0,0,0,0.5);
}
.error { margin-top: 10px; color: #ffb4ae; font-size: 14px; }
.resume-audio {
  position: relative;
  z-index: 5;
  margin-top: 18px;
  min-height: 44px;
  padding: 0 18px;
  border: 1px solid rgba(255,255,255,0.28);
  border-radius: 22px;
  background: rgba(0,0,0,0.38);
  color: #fff;
  cursor: pointer;
  pointer-events: auto;
}
.controls {
  min-height: 110px;
  margin-top: 68px;
  display: flex;
  justify-content: center;
  gap: 28px;
  pointer-events: auto;
}
.video-card .controls {
  margin-top: auto;
  padding-bottom: 8px;
  flex-wrap: wrap;
}
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
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.control-circle.hangup { background: #ff3b30; font-size: 25px; }
.control small { font-size: 13px; text-shadow: 0 1px 4px rgba(0,0,0,0.45); }

@media (max-width: 480px) {
  .controls { gap: 10px; }
  .control { width: 68px; }
  .control-circle { width: 58px; height: 58px; }
  .local-video { width: 28vw; max-width: 120px; border-radius: 14px; }
}
</style>
