<script setup lang="ts">
import BaseButton from '~/components/BaseButton.vue'
import BaseInput from '~/components/BaseInput.vue'

export interface AddContactPayload {
  firstName: string
  lastName: string
  phone: string
}

const props = defineProps<{
  open: boolean
  /** Pre-fill values so the user can lightly edit the current name. */
  initialFirstName: string
  initialLastName?: string | null
  /** Known phone (E.164) — pre-fills the input. Empty means we never saw it. */
  initialPhone?: string | null
  /** Heading flips between add/edit so the same dialog covers both. */
  editing?: boolean
  /** Disables the confirm button + shows a spinner. */
  saving?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm', payload: AddContactPayload): void
}>()

const firstName = ref('')
const lastName = ref('')
const phone = ref('')

// Reset on every open so a previously-typed value doesn't leak between chats.
watch(() => props.open, (isOpen) => {
  if (isOpen) {
    firstName.value = props.initialFirstName
    lastName.value = props.initialLastName ?? ''
    phone.value = props.initialPhone ?? ''
  }
})

// Phone is optional, but if typed it must look like a real number.
const phoneLooksOk = computed(() => {
  const v = phone.value.trim()
  if (!v) return true
  return /\+?[0-9 ()-]{5,}/.test(v)
})
const canSubmit = computed(
  () => firstName.value.trim().length > 0 && phoneLooksOk.value && !props.saving,
)

function submit() {
  if (!canSubmit.value) return
  emit('confirm', {
    firstName: firstName.value.trim(),
    lastName: lastName.value.trim(),
    phone: phone.value.trim(),
  })
}
</script>

<template>
  <Dialog
    :visible="open"
    @update:visible="emit('update:open', $event)"
    modal
    :showHeader="false"
    :draggable="false"
    :pt="{ root: { style: 'border-radius: 18px; overflow: hidden; max-width: 440px; width: 92vw;' } }"
  >
    <div class="contact-dialog">
      <header class="contact-head">
        <div class="contact-icon">
          <i class="pi pi-user-plus" />
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-[18px] font-extrabold text-surface-900">
            {{ editing ? 'Изменить контакт' : 'Добавить в контакты' }}
          </h3>
          <p class="text-[12.5px] text-surface-500 mt-0.5 leading-snug">
            Имя видно всей команде в CRM. Укажешь телефон — контакт появится и в Telegram
            под этим именем.
          </p>
        </div>
        <button class="contact-x" type="button" @click="emit('update:open', false)">
          <i class="pi pi-times" />
        </button>
      </header>

      <div class="contact-body">
        <div>
          <div class="field-label">Имя</div>
          <BaseInput v-model="firstName" placeholder="Например, Иван" />
        </div>
        <div>
          <div class="field-label">Фамилия <span class="opt-tag">необязательно</span></div>
          <BaseInput v-model="lastName" placeholder="Например, Петров" />
        </div>
        <div>
          <div class="field-label">Телефон <span class="opt-tag">необязательно</span></div>
          <BaseInput v-model="phone" placeholder="+998 90 123 45 67" inputmode="tel" />
          <div v-if="!phoneLooksOk" class="phone-hint phone-hint-bad">
            Похоже на ошибку — должно быть хотя бы 5 цифр.
          </div>
          <div v-else class="phone-hint">
            Если оставить пустым — добавим только в CRM, без Telegram.
          </div>
        </div>
      </div>

      <footer class="contact-footer">
        <BaseButton variant="text" :disabled="saving" @click="emit('update:open', false)">
          Отмена
        </BaseButton>
        <BaseButton
          variant="primary"
          :icon="saving ? '' : 'pi pi-check'"
          :loading="saving"
          :disabled="!canSubmit"
          @click="submit"
        >
          {{ editing ? 'Сохранить' : 'Добавить' }}
        </BaseButton>
      </footer>
    </div>
  </Dialog>
</template>

<style scoped>
.contact-dialog { display: flex; flex-direction: column; }
.contact-head {
  display: flex;
  gap: 14px;
  align-items: flex-start;
  padding: 22px 22px 14px;
  border-bottom: 1px solid var(--p-surface-100);
}
.contact-icon {
  width: 44px;
  height: 44px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
  flex-shrink: 0;
}
.contact-icon i { font-size: 19px; }
.contact-x {
  width: 32px; height: 32px;
  border-radius: 9999px;
  display: flex; align-items: center; justify-content: center;
  color: var(--p-surface-400);
  transition: background 0.1s, color 0.1s;
  flex-shrink: 0;
}
.contact-x:hover { background: var(--p-surface-100); color: var(--p-surface-700); }
.contact-body { padding: 18px 22px; display: flex; flex-direction: column; gap: 14px; }
.field-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--p-surface-500);
  margin-bottom: 6px;
  display: flex; align-items: center; gap: 6px;
}
.opt-tag {
  font-weight: 500;
  font-size: 10.5px;
  color: var(--p-surface-400);
  text-transform: lowercase;
}
.phone-hint {
  font-size: 11.5px;
  color: var(--p-surface-400);
  margin-top: 6px;
  line-height: 1.4;
}
.phone-hint-bad { color: #dc2626; }
.contact-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 18px;
  border-top: 1px solid var(--p-surface-100);
}
</style>
