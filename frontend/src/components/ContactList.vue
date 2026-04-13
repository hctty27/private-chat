<template>
  <div class="flex flex-col h-full bg-white">
    <!-- Header -->
    <div class="px-4 py-3 bg-white border-b flex items-center justify-between flex-shrink-0">
      <h2 class="font-semibold text-gray-800">消息</h2>
      <div class="flex items-center gap-1">
        <div
          class="w-2 h-2 rounded-full"
          :class="chatStore.wsConnected ? 'bg-green-500' : 'bg-gray-400'"
        ></div>
        <span class="text-xs text-gray-400">{{ chatStore.wsConnected ? '在线' : '离线' }}</span>
      </div>
    </div>

    <!-- Contact list -->
    <div class="flex-1 overflow-y-auto">
      <div
        v-for="contact in chatStore.sortedContacts"
        :key="contact.userId"
        class="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-gray-50 transition-colors"
        :class="{ 'bg-orange-50': chatStore.currentContact?.userId === contact.userId }"
        @click="$emit('select', contact.userId)"
      >
        <div class="relative flex-shrink-0">
          <div class="w-11 h-11 rounded-full bg-gradient-to-br from-blue-400 to-purple-500 flex items-center justify-center text-white font-bold text-sm">
            {{ contact.nickname[0] }}
          </div>
          <div
            v-if="contact.online"
            class="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-white"
          ></div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between">
            <span class="font-medium text-sm text-gray-900 truncate">{{ contact.nickname }}</span>
            <span v-if="contact.lastMessageTime" class="text-xs text-gray-400 flex-shrink-0 ml-2">
              {{ formatTime(contact.lastMessageTime) }}
            </span>
          </div>
          <div class="flex items-center justify-between mt-1">
            <span class="text-xs text-gray-500 truncate max-w-[160px]">
              {{ contact.lastMessage || '暂无消息' }}
            </span>
            <el-badge
              v-if="contact.unreadCount > 0"
              :value="contact.unreadCount"
              :max="99"
              class="ml-2"
            />
          </div>
        </div>
      </div>

      <div v-if="chatStore.sortedContacts.length === 0" class="flex items-center justify-center h-full text-gray-400 text-sm">
        暂无联系人
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useChatStore } from '../stores/chat'
import { formatTime } from '../utils/time'

defineEmits<{
  select: [userId: number]
}>()

const chatStore = useChatStore()
</script>
