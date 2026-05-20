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
          <label class="field-label">Имя пользователя</label>
          <BaseInput
            v-model="username"
            placeholder="admin"
            autocomplete="username"
            :disabled="pending"
          />
        </div>

        <div class="flex flex-col gap-2">
          <label class="field-label">Пароль</label>
          <BaseInput
            v-model="password"
            :type="showPassword ? 'text' : 'password'"
            placeholder="••••••••"
            autocomplete="current-password"
            :disabled="pending"
          >
            <template #suffix>
              <button
                type="button"
                class="eye-btn"
                tabindex="-1"
                @click="showPassword = !showPassword"
              >
                <i :class="showPassword ? 'pi pi-eye-slash' : 'pi pi-eye'" />
              </button>
            </template>
          </BaseInput>
        </div>

        <Message v-if="error" severity="error" :closable="false" class="!mt-1 !text-sm">
          {{ error }}
        </Message>

        <BaseButton
          type="submit"
          variant="primary"
          size="lg"
          class="!w-full !mt-3"
          :loading="pending"
        >
          <span class="flex items-center justify-center gap-2">
            Войти
            <i v-if="!pending" class="pi pi-arrow-right text-sm" />
          </span>
        </BaseButton>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { login } = useAuth()
const username = ref('')
const password = ref('')
const showPassword = ref(false)
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

.field-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--p-surface-700);
  letter-spacing: 0.01em;
}

.eye-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: var(--p-surface-500);
  cursor: pointer;
}
.eye-btn:hover { background: var(--p-surface-100); color: var(--p-surface-800); }
</style>
