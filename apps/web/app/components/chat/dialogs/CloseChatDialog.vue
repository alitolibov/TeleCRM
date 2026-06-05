<script setup lang="ts">
import BaseInput from '~/components/BaseInput.vue'
import BaseTextarea from '~/components/BaseTextarea.vue'
import BaseDatePicker from '~/components/BaseDatePicker.vue'
import BaseButton from '~/components/BaseButton.vue'

export interface ClosePayload {
  status: string
  flightFrom?: string
  flightTo?: string
  dates?: string
  amount?: number
  comment?: string
}

const props = defineProps<{
  open: boolean
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm', payload: ClosePayload): void
}>()

const { items: clientStatuses, load: loadCloseReasons } = useCloseReasons()

const status = ref('')
const flightFrom = ref('')
const flightTo = ref('')
const dateRange = ref<Date[] | null>(null)
const amount = ref('')
const comment = ref('')

// Reset every time the modal is opened, and make sure the list is loaded.
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    status.value = ''
    flightFrom.value = ''
    flightTo.value = ''
    dateRange.value = null
    amount.value = ''
    comment.value = ''
    loadCloseReasons()
  }
})

function onlyDecimal(raw: string): string {
  return raw.replace(/[^0-9.]/g, '').replace(/(\..*)\./g, '$1')
}

function formatDateRange(range: Date[] | null): string {
  if (!range || !range[0]) return ''
  const fmt = (d: Date) => d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
  const year = range[0].getFullYear()
  if (!range[1] || range[0].toDateString() === range[1].toDateString()) {
    return `${fmt(range[0])} ${year}`
  }
  return `${fmt(range[0])} – ${fmt(range[1])} ${year}`
}

function submit() {
  if (!status.value) return
  emit('confirm', {
    status: status.value,
    flightFrom: flightFrom.value || undefined,
    flightTo: flightTo.value || undefined,
    dates: formatDateRange(dateRange.value) || undefined,
    amount: amount.value ? Number(amount.value) : undefined,
    comment: comment.value || undefined,
  })
}
</script>

<template>
  <Dialog
    :visible="open"
    @update:visible="$emit('update:open', $event)"
    modal
    :showHeader="false"
    :draggable="false"
    :pt="{ root: { style: 'border-radius: 18px; overflow: hidden; max-width: 540px; width: 92vw;' } }"
    class="close-dialog"
  >
    <div class="close-dialog-body">
      <header class="close-head">
        <div>
          <h3 class="text-[19px] font-extrabold text-surface-900">Закрытие чата</h3>
          <p class="text-[13px] text-surface-500 mt-1">
            Зафиксируйте результат общения с клиентом
          </p>
        </div>
        <button class="close-x" @click="$emit('update:open', false)">
          <i class="pi pi-times" />
        </button>
      </header>

      <div class="close-body">
        <!-- Status radios -->
        <div>
          <div class="field-label">
            Статус клиента <span class="text-red-500">*</span>
          </div>
          <div v-if="clientStatuses.length === 0" class="text-[13px] text-surface-400 py-3">
            Статусы пока не настроены. Попросите администратора добавить их в настройках.
          </div>
          <div v-else class="status-grid">
            <label
              v-for="s in clientStatuses" :key="s.id"
              class="status-radio"
              :class="{ 'status-radio-active': status === s.value }"
            >
              <input
                type="radio"
                :value="s.value"
                v-model="status"
                class="sr-only"
              />
              <span class="status-radio-mark" :class="{ 'status-radio-mark-active': status === s.value }">
                <span v-if="status === s.value" class="status-radio-dot" />
              </span>
              <span class="text-[14px] font-medium">{{ s.label }}</span>
            </label>
          </div>
        </div>

        <!-- Flight + amount -->
        <div class="grid grid-cols-2 gap-3">
          <div>
            <div class="field-label">Какой рейс</div>
            <div class="route-pair">
              <BaseInput v-model="flightFrom" placeholder="Откуда" />
              <i class="pi pi-arrow-right route-arrow" />
              <BaseInput v-model="flightTo" placeholder="Куда" />
            </div>
          </div>
          <div>
            <div class="field-label">Сумма</div>
            <BaseInput
              v-model="amount"
              placeholder="0"
              inputmode="decimal"
              :sanitize="onlyDecimal"
              prefix="$"
            />
          </div>
        </div>

        <!-- Dates -->
        <div>
          <div class="field-label">На какие даты</div>
          <BaseDatePicker
            v-model="dateRange"
            selectionMode="range"
            placeholder="Выберите даты"
            dateFormat="d MM yy"
          />
        </div>

        <!-- Comment -->
        <div>
          <div class="field-label">Комментарий менеджера</div>
          <BaseTextarea
            v-model="comment"
            :rows="3"
            placeholder="Подробности о клиенте, договорённости, напоминания..."
          />
        </div>
      </div>

      <footer class="close-footer">
        <BaseButton
          variant="text"
          :disabled="saving"
          @click="$emit('update:open', false)"
        >Отмена</BaseButton>
        <BaseButton
          variant="primary"
          :icon="saving ? '' : 'pi pi-check'"
          :loading="saving"
          :disabled="!status"
          @click="submit"
        >Закрыть чат</BaseButton>
      </footer>
    </div>
  </Dialog>
</template>
