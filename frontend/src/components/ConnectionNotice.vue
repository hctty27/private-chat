<template>
  <div
    v-if="visible"
    class="connection-notice"
    :class="[`is-${props.status}`, { 'is-recovered': props.recoveredNotice && props.status === 'connected' }]"
    role="status"
    aria-live="polite"
  >
    <span class="notice-dot"></span>
    <span class="notice-text">{{ noticeText }}</span>
    <span v-if="props.pendingCount > 0" class="notice-pending">
      {{ props.pendingCount }} 条消息待发送
    </span>
    <button
      v-if="props.status === 'disconnected'"
      class="notice-action"
      type="button"
      @click="emit('reconnect')"
    >
      重连
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'

const props = defineProps<{
  status: ConnectionStatus
  recoveredNotice: boolean
  pendingCount: number
}>()

const emit = defineEmits<{
  reconnect: []
}>()

const visible = computed(() => (
  props.status !== 'connected' || props.recoveredNotice || props.pendingCount > 0
))

const noticeText = computed(() => {
  if (props.status === 'reconnecting') return '连接中断，正在重连...'
  if (props.status === 'disconnected') return '连接已断开'
  if (props.recoveredNotice) return '连接已恢复'
  return '有消息待发送'
})
</script>

<style scoped>
.connection-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 10px;
  background: #fff7ed;
  color: #9a3412;
  font-size: 13px;
  box-shadow: 0 6px 18px rgba(15, 23, 42, 0.08);
}
.notice-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}
.notice-text { font-weight: 500; }
.notice-pending {
  padding-left: 8px;
  border-left: 1px solid rgba(154, 52, 18, 0.25);
  color: inherit;
  opacity: 0.82;
}
.notice-action {
  margin-left: auto;
  border: 0;
  border-radius: 999px;
  padding: 3px 10px;
  background: #f97316;
  color: #fff;
  font-size: 12px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.notice-action:active { transform: scale(0.96); }
.connection-notice.is-reconnecting { color: #0369a1; background: #eff6ff; }
.connection-notice.is-disconnected { color: #b91c1c; background: #fef2f2; }
.connection-notice.is-recovered { color: #15803d; background: #f0fdf4; }
</style>
