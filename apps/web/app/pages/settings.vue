<script setup lang="ts">
import BaseButton from '~/components/BaseButton.vue'
import BaseInput from '~/components/BaseInput.vue'
import BaseTextarea from '~/components/BaseTextarea.vue'
import BaseConfirmDialog from '~/components/BaseConfirmDialog.vue'

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

// === Quick replies (spec 19) — personal templates for everyone ===
const { items: qrItems, load: qrLoad, create: qrCreate, update: qrUpdate, remove: qrRemove } = useQuickReplies()
const qrForm = ref<{ id: string | null; name: string; body: string }>({ id: null, name: '', body: '' })
const qrFormOpen = ref(false)
const qrSaving = ref(false)

function qrStartCreate() {
  qrForm.value = { id: null, name: '', body: '' }
  qrFormOpen.value = true
}
function qrStartEdit(r: { id: string; name: string; body: string }) {
  qrForm.value = { id: r.id, name: r.name, body: r.body }
  qrFormOpen.value = true
}
async function qrSave() {
  const name = qrForm.value.name.trim()
  const body = qrForm.value.body.trim()
  if (!name || !body) return
  qrSaving.value = true
  try {
    if (qrForm.value.id) await qrUpdate(qrForm.value.id, { name, body })
    else await qrCreate({ name, body })
    qrFormOpen.value = false
  } catch (e) { console.error(e) } finally { qrSaving.value = false }
}
const qrDeleteTarget = ref<{ id: string; name: string } | null>(null)
const qrDeleting = ref(false)
async function confirmQrDelete() {
  if (!qrDeleteTarget.value) return
  qrDeleting.value = true
  try {
    await qrRemove(qrDeleteTarget.value.id)
    qrDeleteTarget.value = null
  } catch (e) { console.error(e) } finally { qrDeleting.value = false }
}
onMounted(() => qrLoad())

// === Active sessions (spec 11) ===
interface SessionRow { id: string; userAgent: string | null; ip: string | null; createdAt: string; current: boolean }
const sessions = ref<SessionRow[]>([])
const revokeSessionTarget = ref<SessionRow | null>(null)
const revokingSession = ref(false)

async function loadSessions() {
  try { sessions.value = await api<SessionRow[]>('/auth/sessions') } catch (e) { console.error(e) }
}
async function confirmRevokeSession() {
  if (!revokeSessionTarget.value) return
  revokingSession.value = true
  try {
    await api(`/auth/sessions/${revokeSessionTarget.value.id}/revoke`, { method: 'POST' })
    revokeSessionTarget.value = null
    await loadSessions()
  } catch (e) { console.error(e) } finally { revokingSession.value = false }
}
function deviceName(ua: string | null) {
  if (!ua) return 'Неизвестное устройство'
  const os = /Windows/.test(ua) ? 'Windows' : /Mac OS|Macintosh/.test(ua) ? 'macOS'
    : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : ''
  const br = /Edg/.test(ua) ? 'Edge' : /Firefox/.test(ua) ? 'Firefox'
    : /Chrome/.test(ua) ? 'Chrome' : /Safari/.test(ua) ? 'Safari' : 'Браузер'
  return [br, os].filter(Boolean).join(' · ')
}
function fmtSessionDate(iso: string) {
  return new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
onMounted(loadSessions)

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
    <div class="settings-inner">
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

      <!-- Quick replies (everyone) -->
      <section class="settings-card">
        <header class="settings-card-head">
          <i class="pi pi-bolt text-primary-500" />
          <div class="flex-1">
            <h2 class="text-[15px] font-bold text-surface-900">Быстрые ответы</h2>
            <p class="text-[12px] text-surface-500 mt-0.5">
              Личные шаблоны. В чате вызываются вводом «/» в поле сообщения.
            </p>
          </div>
          <BaseButton variant="secondary" icon="pi pi-plus" @click="qrStartCreate">Добавить</BaseButton>
        </header>

        <!-- Create / edit form -->
        <div v-if="qrFormOpen" class="qr-form">
          <BaseInput v-model="qrForm.name" placeholder="Название (например, привет)" :maxlength="50" />
          <BaseTextarea v-model="qrForm.body" :rows="3" placeholder="Текст ответа, который уйдёт клиенту" :maxlength="2000" />
          <div class="flex items-center gap-2 justify-end">
            <BaseButton variant="text" @click="qrFormOpen = false">Отмена</BaseButton>
            <BaseButton
              variant="primary"
              :loading="qrSaving"
              :disabled="!qrForm.name.trim() || !qrForm.body.trim()"
              @click="qrSave"
            >{{ qrForm.id ? 'Сохранить' : 'Добавить' }}</BaseButton>
          </div>
        </div>

        <!-- List -->
        <div v-if="qrItems.length === 0 && !qrFormOpen" class="text-[13px] text-surface-400 py-3">
          Пока нет шаблонов. Добавьте первый — и вызывайте его в чате через «/».
        </div>
        <div v-else class="flex flex-col gap-2 mt-1">
          <div v-for="r in qrItems" :key="r.id" class="qr-list-item">
            <div class="flex-1 min-w-0">
              <div class="text-[13.5px] font-semibold text-surface-900">/{{ r.name }}</div>
              <div class="text-[12px] text-surface-500 truncate">{{ r.body }}</div>
            </div>
            <button class="qr-icon-btn" title="Изменить" @click="qrStartEdit(r)"><i class="pi pi-pencil" /></button>
            <button class="qr-icon-btn qr-icon-danger" title="Удалить" @click="qrDeleteTarget = { id: r.id, name: r.name }"><i class="pi pi-trash" /></button>
          </div>
        </div>
      </section>

      <!-- Active sessions (everyone) -->
      <section class="settings-card">
        <header class="settings-card-head">
          <i class="pi pi-desktop text-primary-500" />
          <div>
            <h2 class="text-[15px] font-bold text-surface-900">Активные сессии</h2>
            <p class="text-[12px] text-surface-500 mt-0.5">
              Устройства, на которых выполнен вход. Лишние можно завершить.
            </p>
          </div>
        </header>

        <div class="flex flex-col gap-2">
          <div v-for="s in sessions" :key="s.id" class="sess-item">
            <i class="pi pi-desktop sess-icon" />
            <div class="flex-1 min-w-0">
              <div class="text-[13.5px] font-semibold text-surface-900">
                {{ deviceName(s.userAgent) }}
                <span v-if="s.current" class="sess-current">это устройство</span>
              </div>
              <div class="text-[11.5px] text-surface-400 mt-0.5">
                {{ s.ip || '—' }} · вход {{ fmtSessionDate(s.createdAt) }}
              </div>
            </div>
            <button
              v-if="!s.current"
              class="sess-revoke"
              type="button"
              @click="revokeSessionTarget = s"
            >Завершить</button>
          </div>
          <div v-if="sessions.length === 0" class="text-[13px] text-surface-400 py-2">Нет активных сессий</div>
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

    <BaseConfirmDialog
      :open="!!qrDeleteTarget"
      icon="pi pi-trash"
      icon-variant="danger"
      title="Удалить шаблон?"
      confirm-label="Удалить"
      confirm-variant="danger"
      :loading="qrDeleting"
      @update:open="(v: boolean) => !v && (qrDeleteTarget = null)"
      @confirm="confirmQrDelete"
    >
      Быстрый ответ <strong>/{{ qrDeleteTarget?.name }}</strong> будет удалён без возможности восстановления.
    </BaseConfirmDialog>

    <BaseConfirmDialog
      :open="!!revokeSessionTarget"
      icon="pi pi-sign-out"
      icon-variant="danger"
      title="Завершить сессию?"
      confirm-label="Завершить"
      confirm-variant="danger"
      :loading="revokingSession"
      @update:open="(v: boolean) => !v && (revokeSessionTarget = null)"
      @confirm="confirmRevokeSession"
    >
      Сессия на устройстве <strong>{{ deviceName(revokeSessionTarget?.userAgent ?? null) }}</strong> будет завершена.
    </BaseConfirmDialog>
  </div>
</template>

<style scoped>
.settings-page {
  height: 100%;
  overflow-y: auto;
  width: 100%;
}
.settings-inner {
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

.qr-form {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  margin-bottom: 12px;
  background: var(--p-surface-50);
  border: 1px solid var(--p-surface-200);
  border-radius: 12px;
}
.qr-list-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  background: var(--p-surface-50);
  border-radius: 10px;
}
.qr-icon-btn {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--p-surface-500);
  font-size: 13px;
  transition: background 0.12s, color 0.12s;
}
.qr-icon-btn:hover { background: var(--p-surface-200); color: var(--p-surface-800); }
.qr-icon-danger:hover { background: rgba(239, 68, 68, 0.12); color: #dc2626; }

.sess-item {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 11px 13px;
  background: var(--p-surface-50);
  border-radius: 10px;
}
.sess-icon {
  width: 34px; height: 34px;
  flex-shrink: 0;
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  background: var(--p-surface-100);
  color: var(--p-surface-500);
  font-size: 14px;
}
.sess-current {
  font-size: 11px;
  font-weight: 600;
  color: #16a34a;
  background: rgba(34, 197, 94, 0.14);
  padding: 1px 7px;
  border-radius: 6px;
  margin-left: 4px;
}
.sess-revoke {
  flex-shrink: 0;
  height: 32px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: #dc2626;
  background: rgba(239, 68, 68, 0.1);
  transition: background 0.12s;
}
.sess-revoke:hover { background: rgba(239, 68, 68, 0.18); }

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
