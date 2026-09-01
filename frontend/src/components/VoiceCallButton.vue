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

    <Teleport to="body">
      <div
        v-if="menuOpen"
        class="call-menu-layer"
        aria-label="通话方式选择层"
        @click.self="closeMenu"
      >
        <div
          class="call-menu"
          :style="menuPosition"
          role="menu"
          aria-label="选择通话方式"
          @click.stop
        >
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
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
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

const emit = defineEmits<{
  call: [callType: CallType]
}>()

const rootEl = ref<HTMLElement | null>(null)
const menuOpen = ref(false)
const menuPosition = ref<Record<string, string>>({})

function updateMenuPosition() {
  const rect = rootEl.value?.getBoundingClientRect()
  if (!rect) return

  const viewportWidth = document.documentElement.clientWidth
  menuPosition.value = {
    '--call-menu-top': `${Math.round(rect.bottom + 6)}px`,
    '--call-menu-right': `${Math.max(12, Math.round(viewportWidth - rect.right))}px`,
  }
}

function toggleMenu() {
  if (props.disabled) return
  if (menuOpen.value) {
    closeMenu()
    return
  }
  updateMenuPosition()
  menuOpen.value = true
}

function closeMenu() {
  menuOpen.value = false
}

function startCall(kind: CallType) {
  closeMenu()
  if (props.disabled) return
  emit('call', kind)
}

function handleViewportChange() {
  if (menuOpen.value) updateMenuPosition()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeMenu()
}

watch(() => props.disabled, (disabled) => {
  if (disabled) closeMenu()
})

onMounted(() => {
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('orientationchange', handleViewportChange)
  window.visualViewport?.addEventListener('resize', handleViewportChange)
  document.addEventListener('keydown', handleKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('orientationchange', handleViewportChange)
  window.visualViewport?.removeEventListener('resize', handleViewportChange)
  document.removeEventListener('keydown', handleKeydown)
})
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

.call-menu-layer {
  position: fixed;
  inset: 0;
  z-index: 4000;
}
.call-menu {
  position: fixed;
  top: var(--call-menu-top, 64px);
  right: var(--call-menu-right, 16px);
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
  -webkit-tap-highlight-color: transparent;
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

@media (max-width: 767px) {
  .call-menu-layer {
    display: flex;
    align-items: flex-end;
    padding:
      12px
      max(12px, env(safe-area-inset-right))
      calc(12px + env(safe-area-inset-bottom))
      max(12px, env(safe-area-inset-left));
    box-sizing: border-box;
    background: rgba(0,0,0,0.18);
  }
  .call-menu {
    position: relative;
    top: auto;
    right: auto;
    width: 100%;
    padding: 8px;
    border-radius: 16px;
    box-sizing: border-box;
    box-shadow: 0 12px 36px rgba(0,0,0,0.22);
  }
  .call-menu button {
    min-height: 52px;
    padding: 0 14px;
    font-size: 16px;
    border-radius: 12px;
  }
  .menu-icon {
    width: 26px;
    font-size: 20px;
  }
  .video-icon { font-size: 19px; }
}
</style>
