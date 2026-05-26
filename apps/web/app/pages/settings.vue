<script setup lang="ts">
import BaseButton from '~/components/BaseButton.vue'

definePageMeta({ middleware: 'auth' })

const usersStore = useUsersStore()
const { user } = useAuth()
const { api } = useApi()
const { loadMe, setStatus } = useUserStatus()
const { soundEnabled, setEnabled: setSoundEnabled, play: playSound } = useNotificationSound()

const isAdmin = computed(() => user.value?.role === 'admin')

// === Escalation timeouts (admin only, spec 7.3) ===
const escalation = ref({ escalationNewMinutes: 15, escalationReplyMinutes: 30 })
const escalationSaving = ref(false)
const escalationSaved = ref(false)

async function loadEscalation() {
  if (!isAdmin.value) return
  try {
    const s = await api<{ escalationNewMinutes: number; escalationReplyMinutes: number }>('/settings')
    escalation.value = {
      escalationNewMinutes: s.escalationNewMinutes,
      escalationReplyMinutes: s.escalationReplyMinutes,
    }
  } catch (e) { console.error(e) }
}

async function saveEscalation() {
  escalationSaving.value = true
  escalationSaved.value = false
  try {
    await api('/settings', { method: 'PATCH', body: escalation.value })
    escalationSaved.value = true
    setTimeout(() => { escalationSaved.value = false }, 2000)
  } catch (e) {
    console.error(e)
  } finally {
    escalationSaving.value = false
  }
}

// Toggle + play a preview so the user hears what they just enabled.
function onSoundToggle(next: boolean) {
  setSoundEnabled(next)
  if (next) playSound()
}

// === Browser push ===
const push = usePushNotifications()
const pushBusy = ref(false)
const pushDenied = computed(() => push.permission.value === 'denied')

async function onPushToggle(next: boolean) {
  pushBusy.value = true
  try {
    if (next) await push.enable()
    else await push.disable()
  } catch (e) {
    console.error(e)
  } finally {
    pushBusy.value = false
  }
}

onMounted(() => { push.init(); loadEscalation() })

const isOnline = computed(() => usersStore.me?.status === 'online')
const lastSeenLabel = computed(() => {
  const ts = usersStore.me?.lastSeenAt
  if (!ts) return '—'
  return new Date(ts).toLocaleString('ru', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })
})

async function onToggle(next: boolean) {
  try { await setStatus(next ? 'online' : 'offline') } catch (e) { console.error(e) }
}

onMounted(() => {
  // The store may already be hydrated by the layout, but this is cheap and
  // guarantees fresh data when arriving directly via URL.
  loadMe()
})
</script>

<template>
  <div class="settings-page">
    <div class="settings-header">
      <h1 class="text-[22px] font-extrabold text-surface-900">Настройки</h1>
      <p class="text-[13.5px] text-surface-500 mt-1">Управление личным статусом и предпочтениями</p>
    </div>

    <div class="settings-grid">
      <!-- Status section -->
      <section class="settings-card">
        <header class="settings-card-head">
          <i class="pi pi-circle-fill" :class="isOnline ? 'text-green-500' : 'text-surface-300'" />
          <div>
            <h2 class="text-[15px] font-bold text-surface-900">Статус доступности</h2>
            <p class="text-[12px] text-surface-500 mt-0.5">
              Когда «Доступен» — система автоматически направляет новые чаты тебе.
              Когда «Не доступен» — новые чаты идут другим сотрудникам.
            </p>
          </div>
        </header>

        <div class="settings-row">
          <div class="flex flex-col">
            <span class="text-[14px] font-semibold" :class="isOnline ? 'text-green-600' : 'text-surface-600'">
              {{ isOnline ? 'Доступен' : 'Не доступен' }}
            </span>
            <span class="text-[11.5px] text-surface-400 mt-0.5">
              Последняя активность: {{ lastSeenLabel }}
            </span>
          </div>
          <ToggleSwitch :modelValue="isOnline" @update:modelValue="onToggle" />
        </div>

        <div class="settings-hint">
          <i class="pi pi-info-circle text-primary-500 text-[13px] mt-0.5" />
          <span>
            При закрытии вкладки браузера ты автоматически перейдёшь в статус
            «Не доступен» через 5 минут.
          </span>
        </div>
      </section>

      <!-- Notifications section -->
      <section class="settings-card">
        <header class="settings-card-head">
          <i class="pi pi-bell text-primary-500" />
          <div>
            <h2 class="text-[15px] font-bold text-surface-900">Уведомления</h2>
            <p class="text-[12px] text-surface-500 mt-0.5">
              Звуковой сигнал и счётчик непрочитанных на вкладке браузера.
            </p>
          </div>
        </header>

        <div class="settings-row">
          <div class="flex flex-col">
            <span class="text-[14px] font-semibold text-surface-800">Звук при новом сообщении</span>
            <span class="text-[11.5px] text-surface-400 mt-0.5">
              Короткий сигнал, когда приходит сообщение от клиента
            </span>
          </div>
          <ToggleSwitch :modelValue="soundEnabled" @update:modelValue="onSoundToggle" />
        </div>

        <div class="settings-row mt-2">
          <div class="flex flex-col">
            <span class="text-[14px] font-semibold text-surface-800">Push-уведомления в браузере</span>
            <span class="text-[11.5px] text-surface-400 mt-0.5">
              Всплывающие уведомления, даже когда вкладка свёрнута
            </span>
          </div>
          <ToggleSwitch
            :modelValue="push.subscribed.value"
            :disabled="!push.supported.value || pushDenied || pushBusy"
            @update:modelValue="onPushToggle"
          />
        </div>

        <div v-if="!push.supported.value" class="settings-hint">
          <i class="pi pi-exclamation-triangle text-amber-500 text-[13px] mt-0.5" />
          <span>Браузер не поддерживает push-уведомления.</span>
        </div>
        <div v-else-if="pushDenied" class="settings-hint">
          <i class="pi pi-exclamation-triangle text-amber-500 text-[13px] mt-0.5" />
          <span>Уведомления заблокированы в настройках браузера — разреши их для этого сайта, чтобы включить.</span>
        </div>
      </section>

      <!-- Escalation timeouts (admin only) -->
      <section v-if="isAdmin" class="settings-card">
        <header class="settings-card-head">
          <i class="pi pi-clock text-primary-500" />
          <div>
            <h2 class="text-[15px] font-bold text-surface-900">Таймауты эскалации</h2>
            <p class="text-[12px] text-surface-500 mt-0.5">
              Когда уведомлять о чатах без реакции — сначала менеджеру, затем (вдвое дольше) администратору.
            </p>
          </div>
        </header>

        <div class="settings-row">
          <div class="flex flex-col">
            <span class="text-[14px] font-semibold text-surface-800">Новый чат не взят в работу</span>
            <span class="text-[11.5px] text-surface-400 mt-0.5">Минут до уведомления</span>
          </div>
          <input v-model.number="escalation.escalationNewMinutes" type="number" min="1" max="1440" class="esc-input" />
        </div>

        <div class="settings-row mt-2">
          <div class="flex flex-col">
            <span class="text-[14px] font-semibold text-surface-800">Менеджер не ответил клиенту</span>
            <span class="text-[11.5px] text-surface-400 mt-0.5">Минут до уведомления</span>
          </div>
          <input v-model.number="escalation.escalationReplyMinutes" type="number" min="1" max="1440" class="esc-input" />
        </div>

        <div class="flex items-center gap-3 mt-4">
          <BaseButton variant="primary" :loading="escalationSaving" @click="saveEscalation">Сохранить</BaseButton>
          <span v-if="escalationSaved" class="text-[12.5px] text-green-600 font-medium">
            <i class="pi pi-check text-[11px]" /> Сохранено
          </span>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 760px;
  margin: 0 auto;
  padding: 32px 28px 48px;
  width: 100%;
}
.settings-header { margin-bottom: 24px; }
.settings-grid { display: flex; flex-direction: column; gap: 16px; }

.settings-card {
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 14px;
  padding: 20px;
}
.settings-card-head {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-bottom: 16px;
}
.settings-card-head > i { font-size: 12px; margin-top: 6px; }

.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: var(--p-surface-50);
  border-radius: 10px;
}

.esc-input {
  width: 84px;
  height: 38px;
  text-align: center;
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-300);
  border-radius: 9px;
  font-size: 14px;
  font-weight: 600;
  color: var(--p-surface-900);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.esc-input:focus {
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 14%, transparent);
}

.settings-hint {
  display: flex;
  gap: 8px;
  margin-top: 14px;
  padding: 10px 14px;
  background: color-mix(in srgb, var(--p-primary-color) 8%, transparent); 
  border: 1px solid color-mix(in srgb, var(--p-primary-color) 20%, transparent);
  border-radius: 10px;
  font-size: 12.5px;
  color: var(--p-surface-700);
  line-height: 1.45;
}
</style>
