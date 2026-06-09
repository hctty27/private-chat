<template>
  <Transition name="new-message-fade">
    <button
      v-if="props.visible"
      class="new-message-button"
      type="button"
      @click="emit('click')"
    >
      {{ label }}
    </button>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  visible: boolean
  count: number
}>()

const emit = defineEmits<{
  click: []
}>()

const label = computed(() => (props.count > 0 ? `${props.count} 条新消息` : '回到底部'))
</script>

<style scoped>
.new-message-button {
  border: 0;
  border-radius: 999px;
  padding: 7px 14px;
  background: #2563eb;
  color: #fff;
  font-size: 13px;
  font-weight: 500;
  box-shadow: 0 8px 22px rgba(37, 99, 235, 0.28);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.new-message-button:active { transform: scale(0.96); }
.new-message-fade-enter-active,
.new-message-fade-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.new-message-fade-enter-from,
.new-message-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
