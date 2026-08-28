<template>
  <div class="reply-composer-bar">
    <div class="reply-composer-copy">
      <span class="reply-composer-sender">回复 {{ senderName }}</span>
      <span class="reply-composer-summary">{{ messageReplySummary(message) }}</span>
    </div>
    <button class="reply-composer-close tap-target" type="button" aria-label="取消引用" @click="emit('cancel')">×</button>
  </div>
</template>

<script setup lang="ts">
import type { Message } from '../types'
import { messageReplySummary } from '../utils/messageReply'

defineProps<{
  message: Message
  senderName: string
}>()

const emit = defineEmits<{
  cancel: []
}>()
</script>

<style scoped>
.reply-composer-bar {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px 6px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
}
.reply-composer-copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 9px;
  border-left: 3px solid #07c160;
}
.reply-composer-sender,
.reply-composer-summary {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reply-composer-sender {
  color: #2f855a;
  font-size: 12px;
  font-weight: 600;
}
.reply-composer-summary {
  color: #777;
  font-size: 12px;
}
.reply-composer-close {
  width: 32px;
  height: 32px;
  flex: 0 0 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #8e8e93;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.reply-composer-close:hover,
.reply-composer-close:active {
  background: rgba(0, 0, 0, 0.06);
}
</style>
