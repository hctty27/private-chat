<template>
  <button
    class="speech-to-text-btn tap-target"
    :class="{ compact, listening }"
    type="button"
    :disabled="!supported || !contactId || processing"
    :aria-label="listening ? '结束语音转文字' : '语音转文字'"
    :aria-pressed="listening"
    :title="supported ? (listening ? '点击结束听写' : '语音转文字（音频可能由浏览器语音服务处理）') : '当前浏览器不支持语音转文字'"
    @click="toggle"
  >
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="9" y="2.5" width="6" height="12" rx="3" />
      <path d="M6 10.5v1.5a6 6 0 0 0 12 0v-1.5M12 18v3M9 21h6" />
    </svg>
    <span class="speech-text-mark" aria-hidden="true">文</span>
    <span v-if="listening" class="speech-hint" role="status">
      {{ processing ? '正在转换…' : (interim || '正在听写，点击结束') }}
    </span>
  </button>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface RecognitionResult {
  isFinal: boolean
  0: { transcript: string }
}

interface RecognitionEvent {
  resultIndex: number
  results: ArrayLike<RecognitionResult>
}

interface RecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((event: RecognitionEvent) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

type RecognitionConstructor = new () => RecognitionInstance
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor
  webkitSpeechRecognition?: RecognitionConstructor
}

const props = defineProps<{
  contactId: number | null
  compact?: boolean
}>()

const emit = defineEmits<{
  transcript: [value: string, contactId: number]
  warning: [message: string]
  'listening-start': []
}>()

const supported = ref(false)
const listening = ref(false)
const processing = ref(false)
const interim = ref('')
let recognition: RecognitionInstance | null = null

function getConstructor(): RecognitionConstructor | null {
  const browser = window as SpeechWindow
  return browser.SpeechRecognition ?? browser.webkitSpeechRecognition ?? null
}

function cancel() {
  const current = recognition
  recognition = null
  listening.value = false
  processing.value = false
  interim.value = ''
  if (!current) return

  current.onresult = null
  current.onerror = null
  current.onend = null
  try {
    current.abort()
  } catch {
    // The browser may already have stopped recognition.
  }
}

function handleError(error: string) {
  if (error === 'aborted') return
  if (error === 'not-allowed' || error === 'service-not-allowed') {
    emit('warning', '麦克风或语音识别权限被拒绝，请检查浏览器设置')
  } else if (error === 'audio-capture') {
    emit('warning', '无法访问麦克风，请检查浏览器权限')
  } else if (error === 'network') {
    emit('warning', '语音识别服务连接失败，请检查网络')
  } else if (error === 'no-speech') {
    emit('warning', '没有检测到语音，请重试')
  } else {
    emit('warning', '语音识别失败，请重试')
  }
}

function toggle() {
  if (recognition) {
    if (processing.value) return
    processing.value = true
    try {
      recognition.stop()
    } catch {
      cancel()
      emit('warning', '结束语音识别失败，请重试')
    }
    return
  }

  const Constructor = getConstructor()
  const contactId = props.contactId
  if (!Constructor || !contactId) {
    emit('warning', '当前浏览器不支持语音转文字')
    return
  }

  const instance = new Constructor()
  const emittedResultIndexes = new Set<number>()
  instance.lang = 'zh-CN'
  instance.continuous = true
  instance.interimResults = true
  instance.maxAlternatives = 1

  instance.onresult = (event) => {
    if (recognition !== instance || props.contactId !== contactId) return

    let draft = ''
    for (let index = event.resultIndex; index < event.results.length; index++) {
      const result = event.results[index]
      const transcript = result?.[0]?.transcript?.trim() ?? ''
      if (!transcript) continue

      if (result.isFinal) {
        if (emittedResultIndexes.has(index)) continue
        emittedResultIndexes.add(index)
        emit('transcript', transcript, contactId)
      } else {
        draft += transcript
      }
    }
    interim.value = draft
  }

  instance.onerror = (event) => {
    if (recognition !== instance) return
    handleError(event.error)
  }

  instance.onend = () => {
    if (recognition !== instance) return
    recognition = null
    listening.value = false
    processing.value = false
    interim.value = ''
  }

  recognition = instance
  listening.value = true
  processing.value = false
  interim.value = ''

  try {
    instance.start()
    emit('listening-start')
  } catch {
    cancel()
    emit('warning', '无法开始语音识别，请检查浏览器权限')
  }
}

function onPageVisibilityChange() {
  if (document.hidden) cancel()
}

watch(() => props.contactId, cancel)

onMounted(() => {
  supported.value = getConstructor() !== null
  document.addEventListener('visibilitychange', onPageVisibilityChange)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onPageVisibilityChange)
  cancel()
})
</script>

<style scoped>
.speech-to-text-btn {
  position: relative;
  width: 44px;
  height: 44px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 50%;
  padding: 0;
  background: transparent;
  color: #1c1c1e;
  cursor: pointer;
  touch-action: manipulation;
  -webkit-tap-highlight-color: transparent;
}
.speech-to-text-btn.compact {
  width: 36px;
  height: 36px;
  border-radius: 6px;
}
.speech-to-text-btn:hover,
.speech-to-text-btn.listening {
  background: rgba(7, 193, 96, 0.12);
}
.speech-to-text-btn.listening {
  color: #07a956;
}
.speech-to-text-btn svg {
  width: 23px;
  height: 23px;
  pointer-events: none;
}
.speech-text-mark {
  position: absolute;
  right: 2px;
  bottom: 2px;
  font-size: 10px;
  line-height: 1;
  font-weight: 700;
  background: #fff;
  border-radius: 3px;
  pointer-events: none;
}
.speech-hint {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  max-width: min(70vw, 260px);
  min-width: 120px;
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(28, 28, 30, 0.94);
  color: #fff;
  font-size: 12px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.14);
}
</style>
