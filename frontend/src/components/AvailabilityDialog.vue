<template>
  <Teleport to="body">
    <div v-if="visible" class="availability-mask" role="presentation" @click.self="emit('close')">
      <section class="availability-dialog" role="dialog" aria-modal="true" aria-labelledby="availability-title">
        <header class="availability-head">
          <div>
            <h3 id="availability-title">计划上线</h3>
            <p>告诉联系人你下一次大概什么时候有空。</p>
          </div>
          <button type="button" class="availability-close tap-target" aria-label="关闭" @click="emit('close')">✕</button>
        </header>

        <div class="availability-body">
          <label class="field-label" for="availability-start">上线时间</label>
          <input
            id="availability-start"
            v-model="startInput"
            type="datetime-local"
            class="field-control"
            :min="minStart"
          />

          <div class="quick-row" aria-label="快速选择上线时间">
            <button type="button" @click="setQuickStart(30)">30 分钟后</button>
            <button type="button" @click="setQuickStart(60)">1 小时后</button>
            <button type="button" @click="setQuickStart(120)">2 小时后</button>
          </div>

          <span class="field-label">预计在线</span>
          <div class="duration-row" role="group" aria-label="预计在线时长">
            <button
              v-for="option in durationOptions"
              :key="option.minutes"
              type="button"
              :class="{ active: durationMinutes === option.minutes }"
              @click="durationMinutes = option.minutes"
            >{{ option.label }}</button>
          </div>

          <label class="field-label" for="availability-note">备注（可选）</label>
          <input
            id="availability-note"
            v-model="note"
            type="text"
            maxlength="80"
            class="field-control"
            placeholder="例如：晚上聊一会儿"
          />

          <div v-if="loading" class="availability-hint">正在读取当前计划...</div>
          <div v-else-if="hasCurrentPlan" class="availability-current">
            当前计划：{{ currentPlanText }}
          </div>
          <div v-if="errorText" class="availability-error" role="alert">{{ errorText }}</div>
        </div>

        <footer class="availability-actions">
          <button
            v-if="hasCurrentPlan"
            type="button"
            class="clear-btn tap-target"
            :disabled="saving"
            @click="clearPlan"
          >清除计划</button>
          <span v-else></span>
          <button
            type="button"
            class="save-btn tap-target"
            :disabled="saving || loading || !startInput"
            @click="savePlan"
          >{{ saving ? '保存中...' : '保存' }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus/es/components/message/index'
import { clearAvailability, getAvailability, setAvailability } from '../api'
import { formatPlannedOnline } from '../utils/availability'

const props = defineProps<{
  visible: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const durationOptions = [
  { minutes: 30, label: '30 分钟' },
  { minutes: 60, label: '1 小时' },
  { minutes: 120, label: '2 小时' },
  { minutes: 240, label: '4 小时' },
]

const startInput = ref('')
const durationMinutes = ref(60)
const note = ref('')
const loading = ref(false)
const saving = ref(false)
const errorText = ref('')
const currentStartAt = ref<string | null>(null)
const currentEndAt = ref<string | null>(null)

const minStart = computed(() => toLocalInput(new Date(Date.now() - 60_000)))
const hasCurrentPlan = computed(() => !!currentStartAt.value && !!currentEndAt.value)
const currentPlanText = computed(() =>
  formatPlannedOnline(currentStartAt.value, currentEndAt.value) ?? '已过期',
)

watch(() => props.visible, (visible) => {
  if (visible) void loadCurrent()
}, { immediate: true })

function nextDefaultStart() {
  const date = new Date(Date.now() + 30 * 60_000)
  date.setSeconds(0, 0)
  const minutes = date.getMinutes()
  date.setMinutes(minutes <= 30 ? 30 : 60)
  return date
}

function toLocalInput(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hour = String(date.getHours()).padStart(2, '0')
  const minute = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day}T${hour}:${minute}`
}

function setQuickStart(minutes: number) {
  const date = new Date(Date.now() + minutes * 60_000)
  date.setSeconds(0, 0)
  startInput.value = toLocalInput(date)
}

function inferDuration(startAt: string, endAt: string) {
  const start = new Date(startAt)
  const end = new Date(endAt)
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000)
  const match = durationOptions.find((option) => option.minutes === minutes)
  durationMinutes.value = match?.minutes ?? 60
}

async function loadCurrent() {
  loading.value = true
  errorText.value = ''
  try {
    const res = await getAvailability()
    const availability = res.data.data
    currentStartAt.value = availability?.startAt ?? null
    currentEndAt.value = availability?.endAt ?? null
    note.value = availability?.note ?? ''

    if (availability) {
      const start = new Date(availability.startAt)
      if (start.getTime() > Date.now()) {
        startInput.value = toLocalInput(start)
        inferDuration(availability.startAt, availability.endAt)
        return
      }
    }
    startInput.value = toLocalInput(nextDefaultStart())
    durationMinutes.value = 60
  } catch (error: any) {
    errorText.value = error.response?.data?.message || '读取计划失败'
    startInput.value = toLocalInput(nextDefaultStart())
  } finally {
    loading.value = false
  }
}

async function savePlan() {
  errorText.value = ''
  const start = new Date(startInput.value)
  if (Number.isNaN(start.getTime())) {
    errorText.value = '请选择有效的上线时间'
    return
  }
  const end = new Date(start.getTime() + durationMinutes.value * 60_000)

  saving.value = true
  try {
    const res = await setAvailability({
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      note: note.value.trim() || null,
    })
    currentStartAt.value = res.data.data.startAt
    currentEndAt.value = res.data.data.endAt
    ElMessage.success('计划上线时间已保存')
    emit('close')
  } catch (error: any) {
    errorText.value = error.response?.data?.message || '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

async function clearPlan() {
  saving.value = true
  errorText.value = ''
  try {
    await clearAvailability()
    currentStartAt.value = null
    currentEndAt.value = null
    note.value = ''
    ElMessage.success('计划已清除')
    emit('close')
  } catch (error: any) {
    errorText.value = error.response?.data?.message || '清除失败，请重试'
  } finally {
    saving.value = false
  }
}
</script>

<style scoped>
.availability-mask { position: fixed; inset: 0; z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.34); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.availability-dialog { width: min(420px, 100%); max-height: min(660px, calc(100dvh - 40px)); overflow-y: auto; border-radius: 18px; background: #fff; box-shadow: 0 18px 55px rgba(0,0,0,.2); }
.availability-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 20px 20px 14px; border-bottom: 1px solid #f0f0f0; }
.availability-head h3 { margin: 0; font-size: 18px; color: #111; }
.availability-head p { margin: 5px 0 0; font-size: 13px; line-height: 1.45; color: #8e8e93; }
.availability-close { flex: 0 0 36px; width: 36px; height: 36px; border: 0; border-radius: 18px; background: #f5f5f7; color: #666; cursor: pointer; }
.availability-body { display: flex; flex-direction: column; gap: 10px; padding: 18px 20px; }
.field-label { margin-top: 2px; font-size: 13px; font-weight: 600; color: #444; }
.field-control { width: 100%; height: 42px; box-sizing: border-box; border: 1px solid #ddd; border-radius: 10px; padding: 0 12px; font-size: 15px; color: #111; background: #fff; outline: none; }
.field-control:focus { border-color: #576b95; box-shadow: 0 0 0 3px rgba(87,107,149,.12); }
.quick-row, .duration-row { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.quick-row { grid-template-columns: repeat(3, minmax(0, 1fr)); margin-bottom: 6px; }
.quick-row button, .duration-row button { min-height: 38px; border: 1px solid #e1e1e1; border-radius: 9px; background: #f7f7f8; color: #555; font-size: 12px; cursor: pointer; }
.duration-row button.active { border-color: #576b95; background: #eef1f7; color: #435272; font-weight: 600; }
.availability-current { margin-top: 4px; padding: 10px 12px; border-radius: 10px; background: #f4f6fb; color: #576b95; font-size: 13px; }
.availability-hint { margin-top: 4px; color: #999; font-size: 13px; }
.availability-error { margin-top: 4px; color: #dc2626; font-size: 13px; }
.availability-actions { display: flex; justify-content: space-between; gap: 12px; padding: 14px 20px calc(14px + env(safe-area-inset-bottom)); border-top: 1px solid #f0f0f0; }
.clear-btn, .save-btn { min-width: 92px; min-height: 42px; border-radius: 10px; padding: 0 16px; cursor: pointer; }
.clear-btn { border: 1px solid #e5e5e5; background: #fff; color: #999; }
.save-btn { border: 0; background: #576b95; color: #fff; font-weight: 600; }
.clear-btn:disabled, .save-btn:disabled { opacity: .55; cursor: not-allowed; }

@media (max-width: 640px) {
  .availability-mask { align-items: flex-end; padding: 0; }
  .availability-dialog { width: 100%; max-height: min(78dvh, 660px); border-radius: 18px 18px 0 0; }
  .availability-head { padding-top: 16px; }
}
</style>
