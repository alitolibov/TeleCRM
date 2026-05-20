<template>
  <div class="w-full max-w-md px-4">
    <div class="login-card">
      <!-- Logo -->
      <div class="flex items-center gap-3 mb-10">
        <div class="logo-mark">
          <i class="pi pi-comments text-xl" />
        </div>
        <span class="text-[22px] font-extrabold tracking-tight text-surface-900">
          Tele<span class="text-primary">CRM</span>
        </span>
      </div>

      <h2 class="text-[26px] font-extrabold tracking-tight text-surface-900 mb-1.5">
        Добро пожаловать
      </h2>
      <p class="text-[14.5px] text-surface-500 mb-8">
        Войдите, чтобы продолжить
      </p>

      <form @submit.prevent="submit" class="flex flex-col gap-5">
        <div class="flex flex-col gap-2">
          <label class="form-label">Имя пользователя</label>
          <InputText
            v-model="username"
            placeholder="admin"
            autocomplete="username"
            :disabled="pending"
            size="large"
            class="!w-full"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label class="form-label">Пароль</label>
          <Password
            v-model="password"
            placeholder="••••••••"
            :feedback="false"
            toggleMask
            :disabled="pending"
            size="large"
            inputClass="!w-full"
            class="!w-full"
          />
        </div>

        <Message v-if="error" severity="error" :closable="false" class="!mt-1 !text-sm">
          {{ error }}
        </Message>

        <button
          type="submit"
          class="submit-btn"
          :disabled="pending"
        >
          <span v-if="pending" class="flex items-center gap-2">
            <i class="pi pi-spin pi-spinner" /> Вход...
          </span>
          <span v-else class="flex items-center justify-center gap-2">
            Войти
            <i class="pi pi-arrow-right text-sm" />
          </span>
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { login } = useAuth()
const username = ref('')
const password = ref('')
const pending = ref(false)
const error = ref('')

async function submit() {
  error.value = ''
  pending.value = true
  try {
    await login(username.value, password.value)
    await navigateTo('/')
  } catch (e: any) {
    error.value = e?.data?.message ?? 'Неверный логин или пароль'
  } finally {
    pending.value = false
  }
}
</script>

<style scoped>
.login-card {
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 22px;
  padding: 44px;
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.04),
    0 12px 32px rgba(0, 0, 0, 0.08);
}
[data-theme="dark"] .login-card {
  border-color: var(--p-surface-200);
  box-shadow:
    0 1px 2px rgba(0, 0, 0, 0.4),
    0 16px 40px rgba(0, 0, 0, 0.35);
}

.logo-mark {
  width: 48px;
  height: 48px;
  border-radius: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: linear-gradient(135deg, var(--p-primary-color) 0%, #a78bfa 100%);
  box-shadow: 0 8px 20px color-mix(in srgb, var(--p-primary-color) 35%, transparent);
}

.form-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-surface-700);
  letter-spacing: 0.01em;
}

/* Make PrimeVue large inputs feel even more comfortable */
:deep(.p-inputtext),
:deep(.p-password-input) {
  padding: 12px 14px !important;
  font-size: 15px !important;
  border-radius: 12px !important;
  width: 100% !important;
}
:deep(.p-password) {
  width: 100%;
  position: relative;
}
/* Center the eye toggle vertically inside the now-taller input */
:deep(.p-password .p-password-toggle-mask-icon),
:deep(.p-password-toggle-mask-icon) {
  position: absolute !important;
  top: 50% !important;
  right: 14px !important;
  transform: translateY(-50%) !important;
  margin: 0 !important;
}
/* Give the password input room for the eye icon on the right */
:deep(.p-password .p-password-input) {
  padding-right: 42px !important;
}

.submit-btn {
  width: 100%;
  margin-top: 12px;
  padding: 14px 18px;
  font-size: 15px;
  font-weight: 700;
  border-radius: 12px;
  color: #ffffff;
  background: linear-gradient(135deg, var(--p-primary-color) 0%, #a78bfa 100%);
  box-shadow:
    0 6px 16px color-mix(in srgb, var(--p-primary-color) 35%, transparent),
    0 1px 0 rgba(255, 255, 255, 0.1) inset;
  transition: transform 0.12s ease, box-shadow 0.18s ease, filter 0.12s ease;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.submit-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow:
    0 10px 24px color-mix(in srgb, var(--p-primary-color) 42%, transparent),
    0 1px 0 rgba(255, 255, 255, 0.15) inset;
  filter: brightness(1.05);
}
.submit-btn:active:not(:disabled) {
  transform: translateY(0);
  box-shadow:
    0 3px 10px color-mix(in srgb, var(--p-primary-color) 30%, transparent),
    0 1px 0 rgba(255, 255, 255, 0.1) inset;
}
.submit-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}
</style>
