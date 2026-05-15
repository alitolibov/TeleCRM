<template>
  <div class="w-full max-w-sm">
    <div class="bg-surface-0 border border-surface-200 rounded-2xl p-9 shadow-lg">
      <!-- Logo -->
      <div class="flex items-center gap-3 mb-8">
        <div class="w-10 h-10 rounded-xl flex items-center justify-center text-white"
          style="background: linear-gradient(135deg, var(--p-primary-color) 0%, #a78bfa 100%)">
          <i class="pi pi-comments text-lg" />
        </div>
        <span class="text-xl font-extrabold tracking-tight">
          Tele<span class="text-primary">CRM</span>
        </span>
      </div>

      <h2 class="text-xl font-bold text-surface-900 mb-1">Добро пожаловать</h2>
      <p class="text-sm text-surface-500 mb-6">Войдите чтобы продолжить</p>

      <form @submit.prevent="submit" class="flex flex-col gap-4">
        <div class="flex flex-col gap-1.5">
          <label class="text-[12.5px] font-semibold text-surface-700">Имя пользователя</label>
          <InputText
            v-model="username"
            placeholder="admin"
            autocomplete="username"
            :disabled="pending"
            class="w-full"
          />
        </div>

        <div class="flex flex-col gap-1.5">
          <label class="text-[12.5px] font-semibold text-surface-700">Пароль</label>
          <Password
            v-model="password"
            placeholder="••••••••"
            :feedback="false"
            toggleMask
            :disabled="pending"
            inputClass="w-full"
            class="w-full"
          />
        </div>

        <Message v-if="error" severity="error" :closable="false" class="text-sm">
          {{ error }}
        </Message>

        <Button
          type="submit"
          label="Войти"
          class="w-full mt-1"
          :loading="pending"
        />
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
