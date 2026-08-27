<template>
  <span class="message-status" :class="statusClass">
    <template v-if="props.status === 'failed'">
      <span class="status-error" :title="props.error || '发送失败'">发送失败</span>
      <button class="status-retry" type="button" @click="emit('retry')">重试</button>
    </template>

    <template v-else-if="props.status === 'cancelled'">
      <span>已取消</span>
      <button class="status-retry" type="button" @click="emit('retry')">重试</button>
    </template>

    <template v-else-if="props.status === 'upload_queued'">
      <span>等待上传</span>
      <button class="status-cancel" type="button" @click="emit('cancel')">取消</button>
    </template>

    <template v-else-if="props.status === 'uploading'">
      <span>上传中</span>
      <span class="status-progress">{{ normalizedProgress }}%</span>
      <button class="status-cancel" type="button" @click="emit('cancel')">取消</button>
    </template>

    <template v-else-if="props.status === 'queued'">排队中</template>
    <template v-else-if="props.status === 'sending'">发送中</template>
    <template v-else-if="props.showReadState">{{ props.isRead ? '已读' : '未读' }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { LocalMessageStatus } from '../types'

const props = withDefaults(defineProps<{
  status?: LocalMessageStatus
  isRead: boolean
  progress?: number
  error?: string
  showReadState?: boolean
}>(), {
  showReadState: true,
})

const emit = defineEmits<{
  retry: []
  cancel: []
}>()

const normalizedProgress = computed(() => {
  const value = props.progress ?? 0
  return Math.min(100, Math.max(0, Math.round(value)))
})

const statusClass = computed(() => ({
  'is-failed': props.status === 'failed',
  'is-uploading': props.status === 'upload_queued' || props.status === 'uploading',
  'is-pending': props.status === 'queued' || props.status === 'sending',
  'is-cancelled': props.status === 'cancelled',
  'is-read': !props.status && props.showReadState && props.isRead,
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
.is-cancelled { color: #9ca3af; }
.status-progress {
  min-width: 30px;
  font-variant-numeric: tabular-nums;
}
.status-error {
  max-width: 88px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-retry,
.status-cancel {
  border: 0;
  border-radius: 999px;
  padding: 1px 6px;
  font-size: 11px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.status-retry {
  background: #fee2e2;
  color: #dc2626;
}
.status-cancel {
  background: #f3f4f6;
  color: #6b7280;
}
.status-retry:active,
.status-cancel:active { transform: scale(0.96); }
</style>
