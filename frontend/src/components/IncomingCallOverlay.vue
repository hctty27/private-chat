<template>
  <div class="incoming-call-overlay" role="dialog" aria-modal="true" aria-label="语音来电">
    <div class="incoming-card">
      <div class="avatar">{{ peerName.slice(0, 1) || '联' }}</div>
      <div class="name">{{ peerName || '联系人' }}</div>
      <div class="label">邀请你语音通话</div>
      <div class="actions">
        <button type="button" class="action reject" aria-label="拒绝语音通话" @click="reject">
          <span>✕</span>
          <small>拒绝</small>
        </button>
        <button type="button" class="action accept" aria-label="接听语音通话" @click="accept">
          <span>✓</span>
          <small>接听</small>
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useIncomingCallAlert } from '../composables/useIncomingCallAlert'

defineProps<{ peerName: string }>()
const emit = defineEmits<{
  accept: []
  reject: []
}>()

const alert = useIncomingCallAlert()

function accept() {
  alert.stop()
  emit('accept')
}

function reject() {
  alert.stop()
  emit('reject')
}

onMounted(alert.start)
onBeforeUnmount(alert.stop)
</script>

<style scoped>
.incoming-call-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: max(24px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(24px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left));
  box-sizing: border-box;
  background: rgba(24, 24, 27, 0.72);
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}
.incoming-card { width: min(360px, 100%); text-align: center; color: #fff; }
.avatar {
  width: 84px;
  height: 84px;
  margin: 0 auto 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: rgba(255,255,255,0.2);
  font-size: 34px;
  font-weight: 600;
}
.name { font-size: 24px; font-weight: 600; }
.label { margin-top: 8px; font-size: 15px; color: rgba(255,255,255,0.72); }
.actions { display: flex; justify-content: space-around; gap: 48px; margin-top: 72px; }
.action {
  width: 72px;
  border: 0;
  background: transparent;
  color: #fff;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  cursor: pointer;
}
.action span {
  width: 62px;
  height: 62px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
}
.action small { font-size: 13px; }
.reject span { background: #ff3b30; }
.accept span { background: #34c759; }
</style>
