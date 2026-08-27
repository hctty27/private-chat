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

          <div v-if="files.length > 1" class="batch-preview">
            <div v-for="(file, index) in files" :key="`${file.name}-${file.size}-${index}`" class="batch-preview-item">
              <img v-if="previewUrls[index]" :src="previewUrls[index]" :alt="`待发送图片 ${index + 1}`" />
              <div v-else class="file-placeholder" aria-hidden="true">📎</div>
              <span>{{ index + 1 }}</span>
            </div>
          </div>

          <div v-else class="attachment-preview">
            <img v-if="singlePresentation === 'image' && previewUrls[0]" :src="previewUrls[0]" alt="待发送图片预览" />
            <video v-else-if="singlePresentation === 'video' && previewUrls[0]" :src="previewUrls[0]" controls muted playsinline preload="metadata" />
            <div v-else-if="singlePresentation === 'video'" class="video-light-preview">
              <span class="video-light-icon" aria-hidden="true">🎬</span>
              <strong>视频已选择</strong>
              <small>发送后后台生成预览</small>
            </div>
            <div v-else class="file-placeholder" aria-hidden="true">📎</div>
          </div>

          <div v-if="singleFile" class="attachment-meta">
            <template v-if="files.length === 1">
              <strong>{{ singleFile.name }}</strong>
              <span>{{ formatFileSize(singleFile.size) }}</span>
            </template>
            <template v-else>
              <strong>{{ files.length }} 张图片</strong>
              <span>共 {{ formatFileSize(totalSize) }}</span>
            </template>
          </div>
          <div class="recipient">发送给：<strong>{{ recipientName }}</strong></div>

          <div class="attachment-actions">
            <button class="secondary tap-target" type="button" :disabled="busy" @click="emit('cancel')">取消</button>
            <button ref="confirmEl" class="primary tap-target" type="button" :disabled="busy || files.length === 0" @click="emit('confirm')">
              {{ confirmText }}
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
  files: File[]
  recipientName: string
  busy?: boolean
  lightweightVideoPreview?: boolean
}>(), {
  busy: false,
  files: () => [],
  lightweightVideoPreview: false,
})

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const dialogEl = ref<HTMLElement | null>(null)
const confirmEl = ref<HTMLButtonElement | null>(null)
const previewUrls = ref<string[]>([])
let previousFocus: HTMLElement | null = null

const singleFile = computed(() => props.files[0] ?? null)
const totalSize = computed(() => props.files.reduce((total, file) => total + file.size, 0))
const singlePresentation = computed<'image' | 'video' | 'file'>(() => {
  const file = singleFile.value
  if (!file) return 'file'
  if (file.type.startsWith('image/')) return 'image'
  if (file.type.startsWith('video/')) return 'video'
  return 'file'
})
const confirmText = computed(() => {
  if (props.busy) return '发送中…'
  if (props.files.length > 1) return `发送 ${props.files.length} 张`
  return '发送'
})

function revokePreviews() {
  for (const url of previewUrls.value) {
    if (url) URL.revokeObjectURL(url)
  }
  previewUrls.value = []
}

function refreshPreviews() {
  revokePreviews()
  if (!props.visible) return
  previewUrls.value = props.files.map((file) => {
    const isImage = file.type.startsWith('image/')
    const isVideo = file.type.startsWith('video/')
    if (!isImage && !isVideo) return ''
    if (isVideo && props.lightweightVideoPreview) return ''

    try {
      return URL.createObjectURL(file)
    } catch {
      return ''
    }
  })
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

watch(
  [() => props.files, () => props.visible, () => props.lightweightVideoPreview],
  refreshPreviews,
  { immediate: true },
)

watch(() => props.visible, async (visible, wasVisible) => {
  if (visible) {
    previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    document.addEventListener('keydown', onKeydown)
    await nextTick()
    confirmEl.value?.focus()
    return
  }

  document.removeEventListener('keydown', onKeydown)
  revokePreviews()
  if (wasVisible) previousFocus?.focus()
  previousFocus = null
}, { immediate: true })

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  revokePreviews()
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
.batch-preview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin: 16px;
}
.batch-preview-item {
  position: relative;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: 10px;
  background: #f5f5f5;
}
.batch-preview-item img { width: 100%; height: 100%; object-fit: cover; }
.batch-preview-item .file-placeholder { display: flex; width: 100%; height: 100%; align-items: center; justify-content: center; }
.batch-preview-item span {
  position: absolute;
  right: 6px;
  bottom: 6px;
  min-width: 20px;
  height: 20px;
  padding: 0 5px;
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.58);
  color: #fff;
  font-size: 11px;
  line-height: 20px;
  text-align: center;
}
.file-placeholder { font-size: 52px; }
.video-light-preview {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  color: #374151;
  text-align: center;
}
.video-light-icon { font-size: 52px; line-height: 1; }
.video-light-preview strong { font-size: 15px; }
.video-light-preview small { color: #9ca3af; font-size: 12px; }
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
  .batch-preview { grid-template-columns: repeat(3, minmax(0, 1fr)); max-height: 42vh; overflow-y: auto; }
}
</style>
