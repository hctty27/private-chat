<template>
  <div ref="rootEl" class="call-launcher">
    <button
      type="button"
      class="voice-call-button"
      :disabled="disabled"
      aria-label="发起通话"
      aria-haspopup="menu"
      :aria-expanded="menuOpen"
      @click.stop="toggleMenu"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M6.6 2.8 9.2 2a1.4 1.4 0 0 1 1.7.8l1.2 3a1.4 1.4 0 0 1-.4 1.6L10 8.8a14 14 0 0 0 5.2 5.2l1.4-1.7a1.4 1.4 0 0 1 1.6-.4l3 1.2a1.4 1.4 0 0 1 .8 1.7l-.8 2.6a3 3 0 0 1-3.2 2.1C10.7 18.6 5.4 13.3 4.5 6A3 3 0 0 1 6.6 2.8Z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </svg>
    </button>

    <div v-if="menuOpen" class="call-menu" role="menu" aria-label="选择通话方式">
      <button type="button" role="menuitem" @click="startCall('audio')">
        <span class="menu-icon">☎</span>
        <span>语音通话</span>
      </button>
      <button type="button" role="menuitem" @click="startCall('video')">
        <span class="menu-icon video-icon">▣</span>
        <span>视频通话</span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useCallStore } from '../stores/call'
import { useChatStore } from '../stores/chat'
import type { CallType } from '../types'

const props = withDefaults(defineProps<{
  disabled?: boolean
  label?: string
  callType?: CallType
}>(), {
  disabled: false,
  label: '',
  callType: 'audio',
})

defineEmits<{
  call: []
}>()

const callStore = useCallStore()
const chatStore = useChatStore()
const rootEl = ref<HTMLElement | null>(null)
const menuOpen = ref(false)

function toggleMenu() {
  if (props.disabled) return
  menuOpen.value = !menuOpen.value
}

function startCall(kind: CallType) {
  menuOpen.value = false
  const contact = chatStore.currentContact
  if (!contact || props.disabled) return
  void callStore.startCall(contact, kind)
}

function closeOnOutsidePointer(event: PointerEvent) {
  if (!menuOpen.value || rootEl.value?.contains(event.target as Node)) return
  menuOpen.value = false
}

watch(() => props.disabled, (disabled) => {
  if (disabled) menuOpen.value = false
})

onMounted(() => document.addEventListener('pointerdown', closeOnOutsidePointer))
onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutsidePointer))
</script>

<style scoped>
.call-launcher {
  position: relative;
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
}
.voice-call-button {
  width: 44px;
  height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 22px;
  background: transparent;
  color: #1c1c1e;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.voice-call-button:hover:not(:disabled) { background: rgba(0,0,0,0.05); }
.voice-call-button:active:not(:disabled) { background: rgba(0,0,0,0.09); }
.voice-call-button:disabled { opacity: 0.35; cursor: default; }
.voice-call-button svg { width: 23px; height: 23px; }
.call-menu {
  position: absolute;
  z-index: 3050;
  top: calc(100% + 6px);
  right: 0;
  width: 156px;
  padding: 6px;
  border: 1px solid rgba(60,60,67,0.16);
  border-radius: 12px;
  background: rgba(255,255,255,0.98);
  box-shadow: 0 10px 32px rgba(0,0,0,0.16);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
.call-menu button {
  width: 100%;
  min-height: 44px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: #1c1c1e;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  touch-action: manipulation;
}
.call-menu button:hover,
.call-menu button:active { background: rgba(0,0,0,0.06); }
.menu-icon {
  width: 22px;
  text-align: center;
  font-size: 18px;
  line-height: 1;
}
.video-icon { font-size: 17px; }
</style>
