<template>
  <div class="fixed inset-0 flex overflow-hidden bg-gray-100">
    <!-- Desktop: sidebar + chat window -->
    <ContactList
      class="hidden md:flex w-[280px] flex-shrink-0 border-r border-gray-200"
      @select="onContactSelect"
    />
    <ChatWindow
      class="hidden md:flex flex-1 min-w-0"
    />

    <!-- Mobile: show either list or chat -->
    <template v-if="isMobile">
      <ContactList
        v-if="!mobileChatVisible"
        class="flex-1"
        @select="onMobileContactSelect"
      />
      <ChatWindow
        v-else
        class="flex-1"
        @back="mobileChatVisible = false"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { useChatStore } from '../stores/chat'
import ContactList from '../components/ContactList.vue'
import ChatWindow from '../components/ChatWindow.vue'

const chatStore = useChatStore()
const mobileChatVisible = ref(false)

const isMobile = computed(() => {
  if (typeof window === 'undefined') return false
  return window.innerWidth < 768
})

function checkMobile() {
  // Force reactivity
}

onMounted(async () => {
  await chatStore.loadContacts()
  chatStore.connectWs()
  window.addEventListener('resize', checkMobile)
})

onUnmounted(() => {
  chatStore.clearState()
  window.removeEventListener('resize', checkMobile)
})

function onContactSelect(userId: number) {
  chatStore.selectContact(userId)
}

function onMobileContactSelect(userId: number) {
  chatStore.selectContact(userId)
  mobileChatVisible.value = true
}
</script>

<style>
/* Prevent iOS body bounce */
html, body {
  position: fixed;
  width: 100%;
  height: 100%;
  overflow: hidden;
  touch-action: manipulation;
  -webkit-text-size-adjust: 100%;
}
</style>
