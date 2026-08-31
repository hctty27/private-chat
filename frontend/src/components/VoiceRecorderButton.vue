<template>
  <button
    ref="buttonEl"
    class="voice-record-btn tap-target"
    :class="{ compact }"
    type="button"
    aria-label="按住说话"
    title="按住说话，上滑取消"
    @pointerdown.stop.prevent="onPointerDown"
    @pointermove.stop.prevent="onPointerMove"
    @pointerup.stop.prevent="onPointerUp"
    @pointercancel.stop.prevent="onPointerCancel"
    @lostpointercapture="onLostPointerCapture"
    @contextmenu.prevent
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 15.25a3.25 3.25 0 0 0 3.25-3.25V7a3.25 3.25 0 1 0-6.5 0v5A3.25 3.25 0 0 0 12 15.25Zm-1.75-8.25a1.75 1.75 0 1 1 3.5 0v5a1.75 1.75 0 1 1-3.5 0V7Z"/>
      <path d="M6.75 11.75a.75.75 0 0 0-1.5 0A6.76 6.76 0 0 0 11.25 18.46V21h-2.5a.75.75 0 0 0 0 1.5h6.5a.75.75 0 0 0 0-1.5h-2.5v-2.54a6.76 6.76 0 0 0 6-6.71.75.75 0 0 0-1.5 0 5.25 5.25 0 0 1-10.5 0Z"/>
    </svg>
  </button>

  <Teleport to="body">
    <div v-if="status !== 'idle'" class="voice-record-overlay" aria-live="polite">
      <div class="voice-record-card" :class="{ cancelling: cancelByGesture }">
        <div class="voice-record-time">{{ displayTime }}</div>
        <div v-if="status === 'recording'" class="voice-record-wave" aria-hidden="true">
          <span v-for="n in 7" :key="n"></span>
        </div>
        <div class="voice-record-hint">{{ hint }}</div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { pickVoiceMimeType, voiceFileExtension, voiceMaxDurationMs, voiceMinDurationMs } from '../utils/voiceRecording'

defineProps<{
  compact?: boolean
}>()

const emit = defineEmits<{
  recorded: [file: File]
  warning: [message: string]
  'recording-start': []
}>()

type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'finishing'

const buttonEl = ref<HTMLButtonElement | null>(null)
const status = ref<RecorderStatus>('idle')
const cancelByGesture = ref(false)
const elapsedMs = ref(0)

let activePointerId: number | null = null
let pointerActive = false
let startY = 0
let stream: MediaStream | null = null
let recorder: MediaRecorder | null = null
let chunks: Blob[] = []
let selectedMimeType = ''
let recordingStartedAt = 0
let shouldSendAfterStop = false
let elapsedTimer: number | null = null
let maxTimer: number | null = null

const displayTime = computed(() => {
  if (status.value === 'requesting') return '…'
  return Math.min(60, Math.max(0, Math.ceil(elapsedMs.value / 1000))) + '″'
})

const hint = computed(() => {
  if (status.value === 'requesting') return '正在打开麦克风…'
  if (status.value === 'finishing') return '正在处理语音…'
  return cancelByGesture.value ? '松开取消' : '上滑取消，松开发送'
})

function canRecord() {
  return !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'
}

function stopTracks() {
  stream?.getTracks().forEach((track) => track.stop())
  stream = null
}

function clearTimers() {
  if (elapsedTimer !== null) window.clearInterval(elapsedTimer)
  if (maxTimer !== null) window.clearTimeout(maxTimer)
  elapsedTimer = null
  maxTimer = null
}

function resetRecorderState() {
  clearTimers()
  stopTracks()
  recorder = null
  chunks = []
  selectedMimeType = ''
  recordingStartedAt = 0
  shouldSendAfterStop = false
  elapsedMs.value = 0
  cancelByGesture.value = false
  status.value = 'idle'
}

function releasePointerCapture() {
  if (activePointerId === null) return
  const button = buttonEl.value
  try {
    if (button?.hasPointerCapture(activePointerId)) button.releasePointerCapture(activePointerId)
  } catch {
    // The browser may have released capture already.
  }
  activePointerId = null
}

function abandonPointer() {
  pointerActive = false
  releasePointerCapture()
}

async function beginRecording() {
  status.value = 'requesting'
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    })
  } catch {
    if (pointerActive) emit('warning', '无法使用麦克风，请检查浏览器权限')
    abandonPointer()
    resetRecorderState()
    return
  }

  if (!pointerActive) {
    resetRecorderState()
    return
  }

  try {
    selectedMimeType = pickVoiceMimeType((mimeType) => MediaRecorder.isTypeSupported(mimeType))
    const options: MediaRecorderOptions = { audioBitsPerSecond: 64_000 }
    if (selectedMimeType) options.mimeType = selectedMimeType

    recorder = new MediaRecorder(stream, options)
    chunks = []
    recorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) chunks.push(event.data)
    })
    recorder.addEventListener('stop', finalizeRecording, { once: true })
    recorder.addEventListener('error', () => {
      emit('warning', '语音录制失败，请重试')
      resetRecorderState()
    }, { once: true })

    recordingStartedAt = performance.now()
    elapsedMs.value = 0
    status.value = 'recording'
    recorder.start(250)

    elapsedTimer = window.setInterval(() => {
      elapsedMs.value = performance.now() - recordingStartedAt
    }, 100)
    maxTimer = window.setTimeout(() => {
      pointerActive = false
      releasePointerCapture()
      finishRecording(true)
    }, voiceMaxDurationMs)
  } catch {
    emit('warning', '当前浏览器无法开始语音录制')
    abandonPointer()
    resetRecorderState()
  }
}

function finalizeRecording() {
  const elapsed = recordingStartedAt ? performance.now() - recordingStartedAt : 0
  const send = shouldSendAfterStop
  const mimeType = recorder?.mimeType || selectedMimeType || chunks[0]?.type || 'audio/webm'
  const blob = chunks.length > 0 ? new Blob(chunks, { type: mimeType }) : null

  resetRecorderState()

  if (!send) return
  if (elapsed < voiceMinDurationMs) {
    emit('warning', '说话时间太短')
    return
  }
  if (!blob?.size) {
    emit('warning', '没有录到有效语音')
    return
  }

  const extension = voiceFileExtension(mimeType)
  const file = new File([blob], 'voice-' + Date.now() + '.' + extension, {
    type: mimeType,
    lastModified: Date.now(),
  })
  emit('recorded', file)
}

function finishRecording(send: boolean) {
  if (status.value === 'requesting') {
    abandonPointer()
    return
  }
  if (status.value !== 'recording' || !recorder) return

  shouldSendAfterStop = send && !cancelByGesture.value
  clearTimers()
  status.value = 'finishing'

  try {
    recorder.stop()
  } catch {
    resetRecorderState()
  }
}

function onPointerDown(event: PointerEvent) {
  if (status.value !== 'idle') return
  if (event.pointerType === 'mouse' && event.button !== 0) return
  if (!canRecord()) {
    emit('warning', '当前浏览器不支持语音录制')
    return
  }

  activePointerId = event.pointerId
  pointerActive = true
  startY = event.clientY
  cancelByGesture.value = false

  try {
    buttonEl.value?.setPointerCapture(event.pointerId)
  } catch {
    // Pointer capture is an optimization; recording can continue without it.
  }

  emit('recording-start')
  void beginRecording()
}

function onPointerMove(event: PointerEvent) {
  if (!pointerActive || activePointerId !== event.pointerId) return
  const distance = startY - event.clientY
  if (distance >= 64) cancelByGesture.value = true
  else if (distance <= 36) cancelByGesture.value = false
}

function onPointerUp(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return
  pointerActive = false
  releasePointerCapture()
  finishRecording(!cancelByGesture.value)
}

function onPointerCancel(event: PointerEvent) {
  if (activePointerId !== event.pointerId) return
  pointerActive = false
  releasePointerCapture()
  finishRecording(false)
}

function onLostPointerCapture() {
  if (!pointerActive) return
  pointerActive = false
  activePointerId = null
  finishRecording(false)
}

function cancelForPageState() {
  if (!document.hidden || status.value === 'idle') return
  abandonPointer()
  finishRecording(false)
}

onMounted(() => {
  document.addEventListener('visibilitychange', cancelForPageState)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', cancelForPageState)
  abandonPointer()
  if (status.value === 'recording') {
    shouldSendAfterStop = false
    try {
      recorder?.stop()
    } catch {
      // Ignore shutdown errors.
    }
  }
  resetRecorderState()
})
</script>

<style scoped>
.voice-record-btn {
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #1c1c1e;
  cursor: pointer;
  touch-action: none;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}
.voice-record-btn.compact {
  width: 36px;
  height: 36px;
  border-radius: 6px;
}
.voice-record-btn:hover {
  background: rgba(0, 0, 0, 0.06);
}
.voice-record-btn:active {
  background: rgba(0, 0, 0, 0.1);
}
.voice-record-btn svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
  pointer-events: none;
}
.voice-record-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  background: rgba(0, 0, 0, 0.04);
}
.voice-record-card {
  min-width: 172px;
  padding: 20px 22px 16px;
  border-radius: 18px;
  background: rgba(26, 26, 28, 0.9);
  color: #fff;
  text-align: center;
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.2);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}
.voice-record-card.cancelling {
  background: rgba(198, 48, 48, 0.92);
}
.voice-record-time {
  font-size: 26px;
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}
.voice-record-wave {
  height: 32px;
  margin: 10px 0 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.voice-record-wave span {
  width: 3px;
  height: 10px;
  border-radius: 3px;
  background: currentColor;
  animation: voicePulse 0.8s ease-in-out infinite alternate;
}
.voice-record-wave span:nth-child(2),
.voice-record-wave span:nth-child(6) { animation-delay: 0.12s; }
.voice-record-wave span:nth-child(3),
.voice-record-wave span:nth-child(5) { animation-delay: 0.24s; }
.voice-record-wave span:nth-child(4) { animation-delay: 0.36s; }
.voice-record-hint {
  font-size: 13px;
  opacity: 0.88;
}
@keyframes voicePulse {
  from { height: 8px; opacity: 0.65; }
  to { height: 28px; opacity: 1; }
}
</style>
