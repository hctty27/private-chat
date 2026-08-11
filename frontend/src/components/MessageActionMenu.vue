<template>
  <Teleport to="body">
    <Transition name="menu-fade">
      <div v-if="visible" class="message-action-overlay" @pointerdown.self="emit('close')">
        <div class="message-action-menu" role="menu" :style="menuStyle" @pointerdown.stop>
          <button
            v-for="action in actions"
            :key="action"
            class="message-action-item tap-target"
            type="button"
            role="menuitem"
            @click="select(action)"
          >
            {{ labels[action] }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, watch } from 'vue'
import type { MessageAction } from '../utils/messageActions'

const props = withDefaults(defineProps<{
  visible: boolean
  actions: MessageAction[]
  x?: number
  y?: number
}>(), {
  x: 0,
  y: 0,
})

const emit = defineEmits<{
  action: [action: MessageAction]
  close: []
}>()

const labels: Record<MessageAction, string> = {
  copy: '复制',
  view: '查看',
  open: '打开',
  save: '保存',
  retry: '重试',
}

const menuStyle = computed(() => {
  const width = 220
  const estimatedHeight = Math.max(52, props.actions.length * 46 + 12)
  const maxLeft = Math.max(8, window.innerWidth - width - 8)
  const maxTop = Math.max(8, window.innerHeight - estimatedHeight - 8)
  return {
    left: `${Math.min(Math.max(props.x, 8), maxLeft)}px`,
    top: `${Math.min(Math.max(props.y, 8), maxTop)}px`,
  }
})

function select(action: MessageAction) {
  emit('action', action)
  emit('close')
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.visible) emit('close')
}

watch(() => props.visible, (visible) => {
  if (visible) document.addEventListener('keydown', onKeydown)
  else document.removeEventListener('keydown', onKeydown)
}, { immediate: true })

onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.message-action-overlay {
  position: fixed;
  inset: 0;
  z-index: 10030;
}
.message-action-menu {
  position: fixed;
  width: 220px;
  padding: 6px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  background: #fff;
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.2);
}
.message-action-item {
  width: 100%;
  display: flex;
  align-items: center;
  padding: 0 14px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #222;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.message-action-item:hover,
.message-action-item:active { background: #f3f4f6; }
.menu-fade-enter-active,
.menu-fade-leave-active { transition: opacity 0.12s ease; }
.menu-fade-enter-from,
.menu-fade-leave-to { opacity: 0; }
@media (pointer: coarse), (max-width: 767px) {
  .message-action-overlay { background: rgba(0, 0, 0, 0.18); }
  .message-action-menu {
    left: 12px !important;
    right: 12px;
    top: auto !important;
    bottom: calc(12px + env(safe-area-inset-bottom));
    width: auto;
    border-radius: 16px;
    padding: 8px;
  }
  .message-action-item { justify-content: center; min-height: 48px; font-size: 16px; }
}
</style>
