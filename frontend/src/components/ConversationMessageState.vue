<template>
  <div v-if="!hasMessages && state === 'loading'" class="conversation-state" role="status">
    <span class="state-spinner" aria-hidden="true"></span>
    <span>加载消息中...</span>
  </div>

  <div v-else-if="!hasMessages && state === 'error'" class="conversation-state error-state" role="status">
    <span class="state-title" :title="error || undefined">消息加载失败</span>
    <button type="button" class="retry-button" @click="emit('retry')">重新加载</button>
  </div>

  <div v-else-if="!hasMessages && state === 'loaded'" class="conversation-state empty-state-message">
    开始聊天吧
  </div>
</template>

<script setup lang="ts">
import type { MessageLoadState } from '../types'

defineProps<{
  state: MessageLoadState
  hasMessages: boolean
  error?: string
}>()

const emit = defineEmits<{
  retry: []
}>()
</script>

<style scoped>
.conversation-state {
  min-height: 120px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #999;
  font-size: 14px;
}

.state-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #d8d8d8;
  border-top-color: #07c160;
  border-radius: 50%;
  animation: state-spin 0.6s linear infinite;
}

.error-state {
  flex-direction: column;
}

.state-title {
  color: #777;
}

.retry-button {
  min-height: 32px;
  padding: 5px 14px;
  border: 1px solid #d8d8d8;
  border-radius: 8px;
  background: #fff;
  color: #576b95;
  font-size: 13px;
  cursor: pointer;
}

.retry-button:active {
  transform: scale(0.98);
}

.empty-state-message {
  min-height: 100%;
}

@keyframes state-spin {
  to { transform: rotate(360deg); }
}
</style>
