<template>
  <div class="bg-white border rounded-t-lg p-3 relative shadow-lg" @click.stop>
    <div class="grid grid-cols-8 gap-1 max-h-[180px] overflow-y-auto">
      <button
        v-for="emoji in emojis"
        :key="emoji"
        class="w-8 h-8 flex items-center justify-center text-xl hover:bg-gray-100 rounded cursor-pointer transition-colors"
        @click="$emit('select', emoji)"
      >
        {{ emoji }}
      </button>
    </div>
    <button
      class="absolute top-2 right-2 text-gray-400 hover:text-gray-600 text-sm"
      @click="$emit('close')"
    >
      ✕
    </button>
  </div>
</template>

<script setup lang="ts">
defineEmits<{
  select: [emoji: string]
  close: []
}>()

const emojis = [
  '😀', '😁', '😂', '🤣', '😃', '😄', '😅', '😆',
  '😉', '😊', '😋', '😎', '😍', '🥰', '😘', '😗',
  '😙', '😚', '🙂', '🤗', '🤩', '🤔', '🤨', '😐',
  '😑', '😶', '🙄', '😏', '😣', '😥', '😮', '🤐',
  '😯', '😪', '😫', '😴', '😌', '😛', '😜', '😝',
  '🤤', '😒', '😓', '😔', '😕', '🙃', '🤑', '😲',
  '🙁', '😖', '😞', '😟', '😤', '😢', '😭', '😦',
  '😧', '😨', '😩', '🤯', '😬', '😱', '🥵', '🥶',
  '👍', '👎', '👏', '🙌', '🤝', '❤️', '🔥', '🎉',
]
</script>
