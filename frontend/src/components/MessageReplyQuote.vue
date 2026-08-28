<template>
  <button class="message-reply-quote" type="button" @click.stop="emit('jump')">
    <span class="reply-sender">{{ senderName }}</span>
    <span class="reply-summary">{{ messageReplySummary(reply) }}</span>
  </button>
</template>

<script setup lang="ts">
import type { MessageReply } from '../types'
import { messageReplySummary } from '../utils/messageReply'

defineProps<{
  reply: MessageReply
  senderName: string
}>()

const emit = defineEmits<{
  jump: []
}>()
</script>

<style scoped>
.message-reply-quote {
  width: 100%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin: 0 0 7px;
  padding: 6px 8px;
  border: 0;
  border-left: 3px solid rgba(0, 0, 0, 0.26);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.06);
  color: inherit;
  text-align: left;
  cursor: pointer;
}
.reply-sender {
  max-width: 100%;
  overflow: hidden;
  color: #576b95;
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reply-summary {
  max-width: 100%;
  overflow: hidden;
  color: rgba(0, 0, 0, 0.58);
  font-size: 12px;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
