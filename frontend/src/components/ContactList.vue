<template>
  <div class="contact-list-wrap">
    <div class="cl-header">
      <h2>消息</h2>
      <div class="cl-header-right">
        <button class="plan-btn tap-target" type="button" @click="emit('availability')">计划上线</button>
        <span class="ws-dot" :class="{ on: wsConnected }"></span>
        <button class="logout-btn tap-target" type="button" @click="handleLogout">退出</button>
      </div>
    </div>

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

    <div class="cl-list">
      <div
        v-for="c in filteredContacts"
        :key="c.userId"
        class="contact-item"
        :class="{ active: currentId === c.userId }"
        role="button"
        tabindex="0"
        :aria-current="currentId === c.userId ? 'true' : undefined"
        @click="emit('select', c.userId)"
        @keydown.enter.prevent="emit('select', c.userId)"
        @keydown.space.prevent="emit('select', c.userId)"
      >
        <div class="c-avatar">
          {{ c.nickname[0] }}
          <i v-if="c.online" class="c-online"></i>
        </div>
        <div class="c-info">
          <div class="c-top">
            <div class="c-name-row">
              <span class="c-name">
                <template v-if="c.nicknameMatch">
                  <span>{{ c.nicknameMatch.before }}</span>
                  <mark class="c-name-mark">{{ c.nicknameMatch.match }}</mark>
                  <span>{{ c.nicknameMatch.after }}</span>
                </template>
                <template v-else>{{ c.nickname }}</template>
              </span>
              <span
                class="c-status"
                :class="{ on: c.online, planned: !c.online && hasPlannedAvailability(c) }"
                :title="c.availabilityNote || undefined"
              >{{ formatContactPresence(c, undefined, showLastSeen) }}</span>
            </div>
            <span class="c-time" v-if="c.lastMessageTime">{{ fmtTime(c.lastMessageTime) }}</span>
          </div>
          <div class="c-bottom">
            <span class="c-msg">{{ previewText(c) }}</span>
            <span v-if="c.unreadCount > 0" class="c-badge">{{ c.unreadCount > 99 ? '99+' : c.unreadCount }}</span>
          </div>
        </div>
      </div>
      <div v-if="filteredContacts.length === 0 && keyword" class="cl-empty">没有找到联系人</div>
      <div v-else-if="contacts.length === 0" class="cl-empty">暂无联系人，等待添加好友</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessageBox } from 'element-plus/es/components/message-box/index'
import 'element-plus/theme-chalk/base.css'
import 'element-plus/theme-chalk/el-button.css'
import 'element-plus/theme-chalk/el-icon.css'
import 'element-plus/theme-chalk/el-overlay.css'
import 'element-plus/theme-chalk/el-message-box.css'
import type { Contact } from '../types'
import { formatTime as fmtTime } from '../utils/time'
import { formatContactPresence, hasPlannedAvailability } from '../utils/availability'

const props = defineProps<{
  contacts: Contact[]
  currentId: number | null
  wsConnected: boolean
  showLastSeen: boolean
}>()

const emit = defineEmits<{
  select: [id: number]
  availability: []
  logout: []
}>()

const keyword = ref('')
const searching = ref(false)

type NicknameMatch = { before: string; match: string; after: string }
type ContactListItem = Contact & { nicknameMatch: NicknameMatch | null }

const filteredContacts = computed<ContactListItem[]>(() => {
  const kw = keyword.value.trim().toLowerCase()
  return props.contacts
    .filter(c => !kw || c.nickname.toLowerCase().includes(kw))
    .slice()
    .sort(compareContacts)
    .map(c => ({ ...c, nicknameMatch: kw ? getNicknameMatch(c.nickname, kw) : null }))
})

function compareContacts(a: Contact, b: Contact): number {
  const aUnread = a.unreadCount > 0 ? 1 : 0
  const bUnread = b.unreadCount > 0 ? 1 : 0
  if (aUnread !== bUnread) return bUnread - aUnread
  const aTime = getTimeValue(a.lastMessageTime)
  const bTime = getTimeValue(b.lastMessageTime)
  if (aTime !== bTime) return bTime - aTime
  return a.nickname.localeCompare(b.nickname, 'zh-CN')
}

function getTimeValue(time: string): number {
  if (!time) return 0
  const value = new Date(time).getTime()
  return Number.isNaN(value) ? 0 : value
}

function getNicknameMatch(nickname: string, kw: string): NicknameMatch | null {
  const index = nickname.toLowerCase().indexOf(kw)
  if (index < 0) return null
  return {
    before: nickname.slice(0, index),
    match: nickname.slice(index, index + kw.length),
    after: nickname.slice(index + kw.length),
  }
}

function previewText(c: Contact): string {
  if (!c.lastMessage) return '暂无消息'
  if (c.lastMessage.startsWith('[图片]')) return '📷 [图片]'
  if (c.lastMessage.startsWith('[视频]')) return '🎬 [视频]'
  if (c.lastMessage.startsWith('[语音]')) return '🎤 [语音]'
  if (c.lastMessage.startsWith('[文件]')) return '📎 [文件]'
  return c.lastMessage.length > 20 ? c.lastMessage.slice(0, 20) + '...' : c.lastMessage
}

function onSearchBlur() {
  if (!keyword.value) searching.value = false
}

async function handleLogout() {
  try {
    await ElMessageBox.confirm(
      '退出后需要重新登录才能继续聊天。',
      '退出登录',
      {
        confirmButtonText: '退出',
        cancelButtonText: '取消',
        autofocus: false,
        customClass: 'logout-confirm-box',
        confirmButtonClass: 'logout-confirm-primary',
      },
    )
    emit('logout')
  } catch {
    // User cancelled or dismissed the dialog.
  }
}
</script>

<style scoped>
.contact-list-wrap { display: flex; flex-direction: column; height: 100%; background: #fff; }
.cl-header { padding: 16px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #f0f0f0; padding-top: calc(16px + env(safe-area-inset-top)); flex-shrink: 0; }
.cl-header h2 { margin: 0; font-size: 17px; font-weight: 600; }
.cl-header-right { display: flex; align-items: center; gap: 10px; }
.plan-btn { font-size: 12px; color: #576b95; background: #f4f6fb; border: 1px solid #e3e8f2; border-radius: 7px; padding: 4px 9px; cursor: pointer; white-space: nowrap; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.plan-btn:active { background: #e9edf6; }
.logout-btn { font-size: 13px; color: #999; background: none; border: 1px solid #ddd; border-radius: 6px; padding: 2px 10px; cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
.logout-btn:active { background: #f0f0f0; }
.ws-dot { width: 8px; height: 8px; border-radius: 50%; background: #ccc; display: inline-block; }
.ws-dot.on { background: #22c55e; }
.cl-search { padding: 8px 12px; position: relative; flex-shrink: 0; }
.cl-search-input { width: 100%; height: 34px; border: none; background: #f0f2f5; border-radius: 8px; padding: 0 12px 0 32px; font-size: 14px; outline: none; -webkit-appearance: none; box-sizing: border-box; }
.cl-search-icon { position: absolute; left: 20px; top: 50%; transform: translateY(-50%); font-size: 14px; pointer-events: none; }
.cl-list { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; }
.contact-item { display: flex; align-items: center; gap: 12px; padding: 12px 16px; cursor: pointer; -webkit-tap-highlight-color: transparent; outline: none; }
.contact-item:active,
.contact-item.active { background: #f5f5f5; }
.contact-item:focus-visible { box-shadow: inset 0 0 0 2px #2563eb; }
.c-avatar { width: 44px; height: 44px; border-radius: 50%; background: linear-gradient(135deg, #60a5fa, #a78bfa); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 600; font-size: 16px; flex-shrink: 0; position: relative; }
.c-online { position: absolute; bottom: 0; right: 0; width: 10px; height: 10px; border-radius: 50%; background: #22c55e; border: 2px solid #fff; font-style: normal; }
.c-info { flex: 1; min-width: 0; }
.c-top { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.c-name-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.c-name { font-size: 15px; font-weight: 500; color: #111; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.c-name-mark { padding: 0; background: #fef3c7; color: inherit; border-radius: 2px; }
.c-status { flex-shrink: 1; max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; color: #aaa; }
.c-status.on { color: #22c55e; }
.c-status.planned { color: #576b95; }
.c-time { font-size: 12px; color: #999; flex-shrink: 0; }
.c-bottom { display: flex; justify-content: space-between; align-items: center; margin-top: 4px; }
.c-msg { font-size: 13px; color: #999; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; margin-right: 8px; }
.c-badge { flex-shrink: 0; min-width: 18px; height: 18px; padding: 0 5px; background: #ef4444; color: #fff; border-radius: 9px; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.cl-empty { text-align: center; padding: 40px; color: #999; font-size: 14px; }
</style>

<style>
.logout-confirm-box {
  width: min(400px, calc(100vw - 32px));
  border-radius: 16px;
  padding: 18px;
}

.logout-confirm-box .el-message-box__header {
  padding: 0 0 10px;
}

.logout-confirm-box .el-message-box__title {
  font-size: 17px;
  font-weight: 600;
  color: #111;
}

.logout-confirm-box .el-message-box__content {
  padding: 0 0 18px;
}

.logout-confirm-box .el-message-box__message {
  color: #666;
  font-size: 14px;
  line-height: 1.55;
}

.logout-confirm-box .el-message-box__btns {
  gap: 10px;
  padding: 0;
}

.logout-confirm-box .el-button {
  min-width: 82px;
  height: 38px;
  border-radius: 9px;
}

.logout-confirm-box .logout-confirm-primary {
  background: #1c1c1e;
  border-color: #1c1c1e;
  color: #fff;
}

.logout-confirm-box .logout-confirm-primary:hover,
.logout-confirm-box .logout-confirm-primary:focus {
  background: #333336;
  border-color: #333336;
  color: #fff;
}
</style>
