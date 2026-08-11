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
import { computed, nextTick, onUnmounted, watch } from 'vue'
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

let previousFocus: HTMLElement | null = null

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

function menuItems() {
  return Array.from(document.querySelectorAll<HTMLElement>('.message-action-menu [role="menuitem"]'))
}

function select(action: MessageAction) {
  emit('action', action)
  emit('close')
}

function moveFocus(delta: number) {
  const items = menuItems()
  if (items.length === 0) return
  const current = items.indexOf(document.activeElement as HTMLElement)
  const start = current >= 0 ? current : 0
  items[(start + delta + items.length) % items.length].focus()
}

function onKeydown(event: KeyboardEvent) {
  if (!props.visible) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('close')
    return
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    moveFocus(1)
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    moveFocus(-1)
    return
  }
  if (event.key === 'Home') {
    event.preventDefault()
    menuItems()[0]?.focus()
    return
  }
  if (event.key === 'End') {
    event.preventDefault()
    const items = menuItems()
    items[items.length - 1]?.focus()
  }
}

watch(() => props.visible, async (visible, wasVisible) => {
  if (visible) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', onKeydown)
    await nextTick()
    menuItems()[0]?.focus()
    return
  }

  document.removeEventListener('keydown', onKeydown)
  if (wasVisible) previousFocus?.focus()
  previousFocus = null
}, { immediate: true })

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  previousFocus?.focus()
})
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
