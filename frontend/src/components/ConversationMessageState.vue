<template>
  <div />
</template>

<script setup lang="ts">
import type { MessageLoadState } from '../types'

defineProps<{
  state: MessageLoadState
  hasMessages: boolean
  error?: string
}>()

defineEmits<{
  retry: []
}>()
</script>
