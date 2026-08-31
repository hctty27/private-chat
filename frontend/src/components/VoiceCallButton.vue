<template>
  <button
    type="button"
    class="voice-call-button"
    :disabled="disabled"
    :aria-label="label"
    @click="emit('call')"
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
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  disabled?: boolean
  label?: string
}>(), {
  disabled: false,
  label: '语音通话',
})

const emit = defineEmits<{
  call: []
}>()
</script>

<style scoped>
.voice-call-button {
  width: 44px;
  height: 44px;
  flex: 0 0 44px;
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
</style>
