<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="visible" class="attachment-overlay" @pointerdown.self="emit('cancel')">
        <section
          ref="dialogEl"
          class="attachment-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby="attachment-dialog-title"
        >
          <div class="attachment-head">
            <h2 id="attachment-dialog-title">发送附件</h2>
            <button class="dialog-close tap-target" type="button" aria-label="关闭" @click="emit('cancel')">×</button>
          </div>

          <div class="attachment-preview">
            <img v-if="presentation === 'image' && previewUrl" :src="previewUrl" alt="待发送图片预览" />
            <video v-else-if="presentation === 'video' && previewUrl" :src="previewUrl" controls muted playsinline preload="metadata" />
            <div v-else class="file-placeholder" aria-hidden="true">📎</div>
          </div>

          <div v-if="file" class="attachment-meta">
            <strong>{{ file.name }}</strong>
            <span>{{ formatFileSize(file.size) }}</span>
          </div>
          <div class="recipient">发送给：<strong>{{ recipientName }}</strong></div>

          <div class="attachment-actions">
            <button class="secondary tap-target" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
            <button ref="confirmEl" class="primary tap-target" type="button" :disabled="busy || !file" @click="emit('confirm')">
              {{ busy ? '发送中…' : '发送' }}
            </button>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { formatFileSize } from '../utils/time'

const props = withDefaults(defineProps<{
  visible: boolean
  file: File | null
  recipientName: string
  busy?: boolean
}>(), {
  busy: false,
})

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const dialogEl = ref<HTMLElement | null>(null)
const confirmEl = ref<HTMLButtonElement | null>(null)
const previewUrl = ref('')
let previousFocus: HTMLElement | null = null

const presentation = computed<'image' | 'video' | 'file'>(() => {
  if (!props.file) return 'file'
  if (props.file.type.startsWith('image/')) return 'image'
  if (props.file.type.startsWith('video/')) return 'video'
  return 'file'
})

function revokePreview() {
  if (!previewUrl.value) return
  URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
}

function refreshPreview() {
  revokePreview()
  if (!props.visible || !props.file || presentation.value === 'file') return
  try {
    previewUrl.value = URL.createObjectURL(props.file)
  } catch {
    previewUrl.value = ''
  }
}

function focusableControls() {
  if (!dialogEl.value) return []
  return Array.from(dialogEl.value.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
}

function onKeydown(event: KeyboardEvent) {
  if (!props.visible) return
  if (event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
    return
  }
  if (event.key !== 'Tab') return

  const controls = focusableControls()
  if (controls.length === 0) return
  const first = controls[0]
  const last = controls[controls.length - 1]
  const active = document.activeElement

  if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

watch([() => props.file, () => props.visible], refreshPreview, { immediate: true })

watch(() => props.visible, async (visible, wasVisible) => {
  if (visible) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', onKeydown)
    await nextTick()
    confirmEl.value?.focus()
    return
  }

  document.removeEventListener('keydown', onKeydown)
  revokePreview()
  if (wasVisible) previousFocus?.focus()
  previousFocus = null
}, { immediate: true })

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  revokePreview()
  previousFocus?.focus()
})
</script>

<style scoped>
.attachment-overlay {
  position: fixed;
  inset: 0;
  z-index: 10020;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: rgba(0, 0, 0, 0.48);
}
.attachment-dialog {
  width: min(420px, 100%);
  max-height: min(680px, calc(100vh - 40px));
  overflow: auto;
  border-radius: 16px;
  background: #fff;
  box-shadow: 0 24px 70px rgba(0, 0, 0, 0.24);
}
.attachment-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid #eee;
}
.attachment-head h2 { margin: 0; font-size: 17px; }
.dialog-close { border: 0; background: none; font-size: 24px; color: #777; border-radius: 8px; }
.attachment-preview {
  display: flex;
  min-height: 180px;
  max-height: 360px;
  align-items: center;
  justify-content: center;
  margin: 16px;
  overflow: hidden;
  border-radius: 12px;
  background: #f5f5f5;
}
.attachment-preview img,
.attachment-preview video { max-width: 100%; max-height: 360px; object-fit: contain; }
.file-placeholder { font-size: 52px; }
.attachment-meta,
.recipient { display: flex; gap: 8px; padding: 0 16px 10px; color: #555; font-size: 14px; }
.attachment-meta { justify-content: space-between; }
.attachment-meta strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #222; }
.recipient { padding-bottom: 16px; }
.attachment-actions { display: flex; justify-content: flex-end; gap: 10px; padding: 12px 16px 16px; border-top: 1px solid #eee; }
.attachment-actions button { min-width: 76px; border-radius: 8px; padding: 0 16px; font-weight: 600; }
.secondary { border: 1px solid #ddd; background: #fff; color: #444; }
.primary { border: 0; background: #07c160; color: #fff; }
.dialog-fade-enter-active,
.dialog-fade-leave-active { transition: opacity 0.16s ease; }
.dialog-fade-enter-from,
.dialog-fade-leave-to { opacity: 0; }
@media (max-width: 767px) {
  .attachment-overlay { align-items: flex-end; padding: 12px; padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
  .attachment-dialog { width: 100%; border-radius: 18px; }
  .attachment-preview { min-height: 140px; max-height: 42vh; }
}
</style>
