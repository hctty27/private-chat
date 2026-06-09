<template>
  <span class="message-status" :class="statusClass">
    <template v-if="props.status === 'failed'">
      <span class="status-error" :title="props.error || '发送失败'">发送失败</span>
      <button class="status-retry" type="button" @click="emit('retry')">重试</button>
    </template>

    <template v-else-if="props.status === 'uploading'">
      <span>上传中</span>
      <span class="status-progress">{{ normalizedProgress }}%</span>
    </template>

    <template v-else-if="props.status === 'queued'">排队中</template>
    <template v-else-if="props.status === 'sending'">发送中</template>
    <template v-else>{{ props.isRead ? '已读' : '未读' }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LocalMessageStatus } from '../types'

const props = defineProps<{
  status?: LocalMessageStatus
  isRead: boolean
  progress?: number
  error?: string
}>()

const emit = defineEmits<{
  retry: []
}>()

const normalizedProgress = computed(() => {
  const value = props.progress ?? 0
  return Math.min(100, Math.max(0, Math.round(value)))
})

const statusClass = computed(() => ({
  'is-failed': props.status === 'failed',
  'is-uploading': props.status === 'uploading',
  'is-pending': props.status === 'queued' || props.status === 'sending',
  'is-read': !props.status && props.isRead,
}))
</script>

<style scoped>
.message-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #9ca3af;
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
}
.is-read { color: #60a5fa; }
.is-pending,
.is-uploading { color: #d97706; }
.is-failed { color: #dc2626; }
.status-progress {
  min-width: 30px;
  font-variant-numeric: tabular-nums;
}
.status-error {
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-retry {
  border: 0;
  border-radius: 999px;
  padding: 1px 6px;
  background: #fee2e2;
  color: #dc2626;
  font-size: 11px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.status-retry:active { transform: scale(0.96); }
</style>
