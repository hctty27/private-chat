<template>
  <div class="contact-list-wrap">
    <!-- Header -->
    <div class="cl-header">
      <h2>消息</h2>
      <div class="cl-header-right">
        <span class="ws-dot" :class="{ on: wsConnected }"></span>
        <button class="logout-btn" @click="$emit('logout')">退出</button>
      </div>
    </div>

    <!-- Search -->
    <div class="cl-search" v-if="contacts.length > 3">
      <input
        v-model="keyword"
        class="cl-search-input"
        placeholder="搜索联系人"
        @focus="searching = true"
        @blur="onSearchBlur"
      />
      <span class="cl-search-icon">🔍</span>
    </div>

    <!-- List -->
    <div class="cl-list">
      <div
        v-for="c in filteredContacts"
        :key="c.userId"
        class="contact-item"
        :class="{ active: currentId === c.userId }"
        @click="$emit('select', c.userId)"
      >
        <div class="c-avatar">
          {{ c.nickname[0] }}
          <i v-if="c.online" class="c-online"></i>
        </div>
        <div class="c-info">
          <div class="c-top">
            <span class="c-name">{{ c.nickname }}</span>
            <span class="c-time" v-if="c.lastMessageTime">{{ fmtTime(c.lastMessageTime) }}</span>
          </div>
          <div class="c-bottom">
            <span class="c-msg">{{ previewText(c) }}</span>
            <span v-if="c.unreadCount > 0" class="c-badge">{{ c.unreadCount > 99 ? '99+' : c.unreadCount }}</span>
          </div>
        </div>
      </div>
      <div v-if="filteredContacts.length === 0 && keyword" class="cl-empty">无匹配联系人</div>
      <div v-else-if="contacts.length === 0" class="cl-empty">暂无联系人</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Contact } from '../types'
import { formatTime as fmtTime } from '../utils/time'

const props = defineProps<{
  contacts: Contact[]
  currentId: number | null
  wsConnected: boolean
}>()

defineEmits<{
  select: [id: number]
  logout: []
}>()

const keyword = ref('')
const searching = ref(false)

const filteredContacts = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return props.contacts
  return props.contacts.filter(c => c.nickname.toLowerCase().includes(kw))
})

function previewText(c: Contact): string {
  if (!c.lastMessage) return '暂无消息'
  // 图片/文件类型显示标签
  if (c.lastMessage.startsWith('[图片]')) return '📷 [图片]'
  if (c.lastMessage.startsWith('[文件]')) return '📎 [文件]'
  return c.lastMessage.length > 20 ? c.lastMessage.slice(0, 20) + '...' : c.lastMessage
}

function onSearchBlur() {
  if (!keyword.value) searching.value = false
}
</script>

<style scoped>
.contact-list-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #fff;
}
.cl-header {
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid #f0f0f0;
  padding-top: calc(16px + env(safe-area-inset-top));
  flex-shrink: 0;
}
.cl-header h2 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
.cl-header-right {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logout-btn {
  font-size: 13px;
  color: #999;
  background: none;
  border: 1px solid #ddd;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.logout-btn:active { background: #f0f0f0; }
.ws-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ccc;
  display: inline-block;
}
.ws-dot.on { background: #22c55e; }

.cl-search {
  padding: 8px 12px;
  position: relative;
  flex-shrink: 0;
}
.cl-search-input {
  width: 100%;
  height: 34px;
  border: none;
  background: #f0f2f5;
  border-radius: 8px;
  padding: 0 12px 0 32px;
  font-size: 14px;
  outline: none;
  -webkit-appearance: none;
  box-sizing: border-box;
}
.cl-search-icon {
  position: absolute;
  left: 20px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 14px;
  pointer-events: none;
}

.cl-list {
  flex: 1;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
}
.contact-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.contact-item:active,
.contact-item.active {
  background: #f5f5f5;
}
.c-avatar {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: linear-gradient(135deg, #60a5fa, #a78bfa);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 600;
  font-size: 16px;
  flex-shrink: 0;
  position: relative;
}
.c-online {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #22c55e;
  border: 2px solid #fff;
  font-style: normal;
}
.c-info {
  flex: 1;
  min-width: 0;
}
.c-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.c-name {
  font-size: 15px;
  font-weight: 500;
  color: #111;
}
.c-time {
  font-size: 12px;
  color: #999;
  flex-shrink: 0;
}
.c-bottom {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 4px;
}
.c-msg {
  font-size: 13px;
  color: #999;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 8px;
}
.c-badge {
  flex-shrink: 0;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  background: #ef4444;
  color: #fff;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cl-empty {
  text-align: center;
  padding: 40px;
  color: #999;
  font-size: 14px;
}
</style>
