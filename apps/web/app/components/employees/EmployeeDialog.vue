<script setup lang="ts">
import type { EmployeeWithStats, EmployeeCreate, EmployeeUpdate } from '~/composables/useEmployees'

const props = defineProps<{
  open: boolean
  /** When set — edit mode; otherwise — create mode. */
  employee: EmployeeWithStats | null
  saving?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submit', payload: EmployeeCreate | (EmployeeUpdate & { id: string })): void
}>()

const isEdit = computed(() => !!props.employee)

const username = ref('')
const password = ref('')
const firstName = ref('')
const lastName = ref('')
const role = ref<'admin' | 'manager'>('manager')

// Reset on open: pre-fill in edit mode, empty in create mode.
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  if (props.employee) {
    username.value = props.employee.username
    password.value = ''
    firstName.value = props.employee.firstName
    lastName.value = props.employee.lastName ?? ''
    role.value = props.employee.role
  } else {
    username.value = ''
    password.value = ''
    firstName.value = ''
    lastName.value = ''
    role.value = 'manager'
  }
})

function submit() {
  if (isEdit.value) {
    const payload: EmployeeUpdate & { id: string } = {
      id: props.employee!.id,
      firstName: firstName.value.trim(),
      lastName: lastName.value.trim() || undefined,
      role: role.value,
    }
    if (password.value) payload.password = password.value
    emit('submit', payload)
  } else {
    const payload: EmployeeCreate = {
      username: username.value.trim(),
      password: password.value,
      firstName: firstName.value.trim(),
      lastName: lastName.value.trim() || undefined,
      role: role.value,
    }
    emit('submit', payload)
  }
}

const canSubmit = computed(() => {
  if (!firstName.value.trim()) return false
  if (!isEdit.value) {
    if (!username.value.trim() || !password.value) return false
    if (password.value.length < 8 || !/\d/.test(password.value)) return false
  } else if (password.value && (password.value.length < 8 || !/\d/.test(password.value))) {
    return false
  }
  return true
})
</script>

<template>
  <Dialog
    :visible="open"
    @update:visible="$emit('update:open', $event)"
    modal
    :showHeader="false"
    :closable="false"
    :draggable="false"
    :pt="{ root: { style: 'border-radius: 18px; overflow: hidden; max-width: 460px; width: 92vw;' } }"
  >
    <div class="emp-dialog">
      <header class="emp-dialog-head">
        <h3 class="text-[18px] font-extrabold text-surface-900">
          {{ isEdit ? 'Изменить сотрудника' : 'Новый сотрудник' }}
        </h3>
        <button class="emp-dialog-x" @click="$emit('update:open', false)">
          <i class="pi pi-times" />
        </button>
      </header>

      <div class="emp-dialog-body">
        <div>
          <label class="field-label">Имя <span class="text-red-500">*</span></label>
          <BaseInput v-model="firstName" placeholder="Имя" />
        </div>

        <div>
          <label class="field-label">Фамилия</label>
          <BaseInput v-model="lastName" placeholder="Фамилия" />
        </div>

        <div>
          <label class="field-label">Логин <span v-if="!isEdit" class="text-red-500">*</span></label>
          <BaseInput
            v-model="username"
            placeholder="username"
            :disabled="isEdit"
          />
          <div v-if="isEdit" class="emp-hint">логин нельзя изменить после создания</div>
        </div>

        <div>
          <label class="field-label">
            {{ isEdit ? 'Новый пароль (необязательно)' : 'Пароль' }}
            <span v-if="!isEdit" class="text-red-500">*</span>
          </label>
          <BaseInput
            v-model="password"
            type="password"
            :placeholder="isEdit ? 'оставь пустым чтобы не менять' : 'минимум 8 символов, хотя бы 1 цифра'"
          />
        </div>

        <div>
          <label class="field-label">Роль <span class="text-red-500">*</span></label>
          <div class="role-grid">
            <label class="role-radio" :class="{ 'role-radio-active': role === 'manager' }">
              <input type="radio" value="manager" v-model="role" class="sr-only" />
              <i class="pi pi-user" />
              <div class="flex flex-col">
                <span class="text-[13.5px] font-semibold">Менеджер</span>
                <span class="text-[11.5px] opacity-70">обрабатывает чаты</span>
              </div>
            </label>
            <label class="role-radio" :class="{ 'role-radio-active': role === 'admin' }">
              <input type="radio" value="admin" v-model="role" class="sr-only" />
              <i class="pi pi-shield" />
              <div class="flex flex-col">
                <span class="text-[13.5px] font-semibold">Администратор</span>
                <span class="text-[11.5px] opacity-70">полный доступ</span>
              </div>
            </label>
          </div>
        </div>

        <div v-if="error" class="emp-error">
          <i class="pi pi-exclamation-circle" />
          <span>{{ error }}</span>
        </div>
      </div>

      <footer class="emp-dialog-footer">
        <BaseButton variant="text" :disabled="saving" @click="$emit('update:open', false)">
          Отмена
        </BaseButton>
        <BaseButton
          variant="primary"
          :icon="saving ? '' : 'pi pi-check'"
          :loading="saving"
          :disabled="!canSubmit || saving"
          @click="submit"
        >
          {{ isEdit ? 'Сохранить' : 'Создать' }}
        </BaseButton>
      </footer>
    </div>
  </Dialog>
</template>

<style scoped>
.emp-dialog { display: flex; flex-direction: column; }
.emp-dialog-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 6px;
}
.emp-dialog-x {
  width: 28px; height: 28px; border-radius: 50%;
  background: none; border: none; cursor: pointer;
  color: var(--p-surface-500);
  display: flex; align-items: center; justify-content: center;
}
.emp-dialog-x:hover { background: var(--p-surface-100); color: var(--p-surface-800); }

.emp-dialog-body {
  display: flex; flex-direction: column; gap: 14px;
  padding: 10px 22px 18px;
}

.field-label {
  display: block;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--p-surface-600);
  margin-bottom: 5px;
}

.emp-hint {
  font-size: 11.5px;
  color: var(--p-surface-400);
  margin-top: 4px;
}

.role-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.role-radio {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px;
  border: 1px solid var(--p-surface-200);
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.12s;
  background: var(--p-surface-0);
}
.role-radio:hover { border-color: var(--p-surface-400); }
.role-radio > i { font-size: 16px; color: var(--p-surface-500); }
.role-radio-active {
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 6%, transparent);
}
.role-radio-active > i { color: var(--p-primary-color); }

.emp-error {
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px;
  background: color-mix(in srgb, #ef4444 8%, transparent);
  border: 1px solid color-mix(in srgb, #ef4444 25%, transparent);
  border-radius: 8px;
  color: #ef4444;
  font-size: 12.5px;
}

.emp-dialog-footer {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 22px 18px;
  border-top: 1px solid var(--p-surface-200);
}
</style>
