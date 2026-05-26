<script setup lang="ts">
import BaseTextarea from '~/components/BaseTextarea.vue'
import BaseButton from '~/components/BaseButton.vue'
import { avatarColor, initials } from '~/utils/format'

export interface TransferPayload {
  toUserId: string | null   // null → return to the общая очередь
  comment: string
}

const props = defineProps<{
  open: boolean
  saving?: boolean
  /** Current owner — excluded from the target list. */
  currentAssigneeId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm', payload: TransferPayload): void
}>()

const usersStore = useUsersStore()
const { user } = useAuth()

// Target candidates: everyone except the current owner. (Admins included —
// руководитель общается наравне с менеджерами.)
const candidates = computed(() =>
  usersStore.all.filter(u => u.id !== props.currentAssigneeId),
)

// '' = nothing chosen yet, 'queue' = back to queue, otherwise a user id.
const target = ref<string>('')
const comment = ref('')

watch(() => props.open, (isOpen) => {
  if (isOpen) { target.value = ''; comment.value = '' }
})

const commentOk = computed(() => comment.value.trim().length >= 10)
const canSubmit = computed(() => target.value !== '' && commentOk.value)

function submit() {
  if (!canSubmit.value) return
  emit('confirm', {
    toUserId: target.value === 'queue' ? null : target.value,
    comment: comment.value.trim(),
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
    :pt="{ root: { style: 'border-radius: 18px; overflow: hidden; max-width: 480px; width: 92vw;' } }"
    class="close-dialog"
  >
    <div class="close-dialog-body">
      <header class="close-head">
        <div>
          <h3 class="text-[19px] font-extrabold text-surface-900">Передать чат</h3>
          <p class="text-[13px] text-surface-500 mt-1">
            Выберите сотрудника или верните чат в общую очередь
          </p>
        </div>
        <button class="close-x" @click="$emit('update:open', false)">
          <i class="pi pi-times" />
        </button>
      </header>

      <div class="close-body">
        <!-- Target picker -->
        <div>
          <div class="field-label">Кому передать <span class="text-red-500">*</span></div>
          <div class="transfer-list">
            <!-- Return to queue -->
            <button
              type="button"
              class="transfer-item"
              :class="{ 'transfer-item-active': target === 'queue' }"
              @click="target = 'queue'"
            >
              <span class="transfer-icon"><i class="pi pi-inbox" /></span>
              <span class="flex-1 text-left">
                <span class="block text-[14px] font-semibold text-surface-800">В общую очередь</span>
                <span class="block text-[11.5px] text-surface-400">Любой свободный сотрудник возьмёт чат</span>
              </span>
              <i v-if="target === 'queue'" class="pi pi-check transfer-check" />
            </button>

            <button
              v-for="u in candidates" :key="u.id"
              type="button"
              class="transfer-item"
              :class="{ 'transfer-item-active': target === u.id }"
              @click="target = u.id"
            >
              <span class="avatar-circle sm" :class="avatarColor(u.id.charCodeAt(0) + u.id.charCodeAt(1))">
                {{ initials(u.firstName, u.lastName) }}
              </span>
              <span class="flex-1 text-left min-w-0">
                <span class="block text-[14px] font-semibold text-surface-800 truncate">
                  {{ u.firstName }} {{ u.lastName ?? '' }}
                  <span v-if="u.id === user?.id" class="text-[11.5px] text-primary-500 font-semibold">(вы)</span>
                </span>
                <span class="block text-[11.5px] text-surface-400">
                  {{ u.role === 'admin' ? 'Администратор' : 'Менеджер' }}
                </span>
              </span>
              <span class="transfer-presence" :class="u.status === 'online' ? 'transfer-on' : 'transfer-off'" />
              <i v-if="target === u.id" class="pi pi-check transfer-check" />
            </button>

            <div v-if="candidates.length === 0" class="text-[13px] text-surface-400 py-3 text-center">
              Нет других сотрудников
            </div>
          </div>
        </div>

        <!-- Comment -->
        <div>
          <div class="field-label">
            Комментарий <span class="text-red-500">*</span>
            <span class="text-[11px] font-normal text-surface-400">(минимум 10 символов)</span>
          </div>
          <BaseTextarea
            v-model="comment"
            :rows="3"
            placeholder="Зачем передаёте, что важно знать принимающему..."
          />
          <div class="text-[11px] mt-1" :class="commentOk ? 'text-surface-400' : 'text-amber-500'">
            {{ comment.trim().length }} / 10
          </div>
        </div>
      </div>

      <footer class="close-footer">
        <BaseButton variant="text" :disabled="saving" @click="$emit('update:open', false)">
          Отмена
        </BaseButton>
        <BaseButton
          variant="primary"
          :icon="saving ? '' : 'pi pi-send'"
          :loading="saving"
          :disabled="!canSubmit"
          @click="submit"
        >Передать</BaseButton>
      </footer>
    </div>
  </Dialog>
</template>

<style scoped>
.transfer-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 260px;
  overflow-y: auto;
}
.transfer-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 9px 12px;
  border-radius: 11px;
  background: var(--p-surface-100);
  border: 1.5px solid transparent;
  transition: background 0.12s, border-color 0.12s;
}
.transfer-item:hover { border-color: var(--p-surface-300); }
.transfer-item-active {
  border-color: var(--p-primary-color) !important;
  background: color-mix(in srgb, var(--p-primary-color) 10%, transparent) !important;
}
.transfer-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
  font-size: 12px;
}
.transfer-presence {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  flex-shrink: 0;
}
.transfer-on { background: #22c55e; }
.transfer-off { background: var(--p-surface-300); }
.transfer-check { color: var(--p-primary-color); font-size: 13px; flex-shrink: 0; }
</style>
