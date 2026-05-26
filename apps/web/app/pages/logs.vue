<script setup lang="ts">
import BaseSelect from '~/components/BaseSelect.vue'
import BaseDatePicker from '~/components/BaseDatePicker.vue'

definePageMeta({ middleware: 'auth' })

interface LogRow {
  id: string
  action: string
  metadata: any
  createdAt: string
  actorName: string | null
  targetName: string | null
  clientName: string | null
  clientUsername: string | null
}

const { user } = useAuth()
const { api } = useApi()
const usersStore = useUsersStore()

const actionMeta: Record<string, { label: string; icon: string; cls: string }> = {
  chat_assigned:       { label: 'Назначение чата',     icon: 'pi pi-user-plus',            cls: 'lg-primary' },
  chat_transferred:    { label: 'Передача чата',        icon: 'pi pi-send',                 cls: 'lg-primary' },
  chat_status_changed: { label: 'Статус чата',          icon: 'pi pi-flag',                 cls: 'lg-blue' },
  chat_escalated:      { label: 'Эскалация',            icon: 'pi pi-exclamation-triangle', cls: 'lg-amber' },
  user_login:          { label: 'Вход',                 icon: 'pi pi-sign-in',              cls: 'lg-green' },
  user_logout:         { label: 'Выход',                icon: 'pi pi-sign-out',             cls: 'lg-gray' },
  user_status_changed: { label: 'Статус сотрудника',    icon: 'pi pi-circle-fill',          cls: 'lg-gray' },
  user_created:        { label: 'Создан сотрудник',     icon: 'pi pi-user-plus',            cls: 'lg-green' },
  user_deleted:        { label: 'Удалён сотрудник',     icon: 'pi pi-user-minus',           cls: 'lg-danger' },
}
const clientStatusLabels: Record<string, string> = {
  thinking: 'Думает', consulting: 'Посоветоваться', waiting_price: 'Ждёт цену', booked: 'Забронировал', bought: 'Купил',
}

// === Filters ===
const action = ref('')
const actor = ref('')
const range = ref<Date[] | null>(null)
const rows = ref<LogRow[]>([])
const offset = ref(0)
const hasMore = ref(false)
const loading = ref(false)

const actionOptions = computed(() => [
  { label: 'Все действия', value: '' },
  ...Object.entries(actionMeta).map(([value, m]) => ({ value, label: m.label })),
])
const actorOptions = computed(() => [
  { label: 'Все сотрудники', value: '' },
  ...usersStore.all.map(u => ({ value: u.id, label: `${u.firstName} ${u.lastName ?? ''}`.trim() })),
])
const hasFilter = computed(() => !!(action.value || actor.value || range.value?.length))

function buildQuery(off: number): string {
  const p = new URLSearchParams({ limit: '50', offset: String(off) })
  if (action.value) p.set('action', action.value)
  if (actor.value) p.set('actorId', actor.value)
  const r = range.value
  if (r?.[0] && r[1]) {
    const from = new Date(r[0]); from.setHours(0, 0, 0, 0)
    const to = new Date(r[1]); to.setHours(23, 59, 59, 999)
    p.set('dateFrom', from.toISOString())
    p.set('dateTo', to.toISOString())
  }
  return p.toString()
}

async function load(reset = true) {
  loading.value = true
  try {
    const off = reset ? 0 : offset.value
    const res = await api<{ items: LogRow[]; hasMore: boolean }>(`/logs?${buildQuery(off)}`)
    rows.value = reset ? res.items : [...rows.value, ...res.items]
    offset.value = off + res.items.length
    hasMore.value = res.hasMore
  } catch (e) { console.error(e) } finally { loading.value = false }
}

let timer: ReturnType<typeof setTimeout> | null = null
watch([action, actor, range], () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => load(true), 200)
})

function resetFilters() { action.value = ''; actor.value = ''; range.value = null }

function userName(id?: string) {
  if (!id) return '—'
  return usersStore.all.find(u => u.id === id)?.firstName ?? 'сотрудник'
}
function chatStatusLabel(s?: string) {
  return s === 'new' ? 'Новый' : s === 'active' ? 'В работе' : s === 'closed' ? 'Закрыт' : (s ?? '')
}

/** Human-readable detail line for a log entry. */
function describe(log: LogRow): string {
  const m = log.metadata || {}
  switch (log.action) {
    case 'chat_assigned':
      return m.reason === 'auto_distribute' ? `Авто-распределён → ${userName(m.to)}` : `Назначен → ${userName(m.to)}`
    case 'chat_transferred':
      return `${m.from ? userName(m.from) : '—'} → ${m.to ? userName(m.to) : 'очередь'}${m.comment ? `: «${m.comment}»` : ''}`
    case 'chat_status_changed':
      if (m.trigger === 'taken_into_work') return 'Взят в работу'
      if (m.to === 'closed') return `Закрыт${m.clientStatus ? ` · ${clientStatusLabels[m.clientStatus] ?? m.clientStatus}` : ''}`
      return `${chatStatusLabel(m.from)} → ${chatStatusLabel(m.to)}`
    case 'chat_escalated':
      return `${m.kind === 'unpicked' ? 'Не взят в работу' : 'Без ответа клиенту'} · уровень ${m.level}`
    case 'user_status_changed':
      return `${m.from === 'online' ? 'Online' : 'Offline'} → ${m.to === 'online' ? 'Online' : 'Offline'}`
    case 'user_created':
      return `${m.username ?? ''} (${m.role === 'admin' ? 'админ' : 'менеджер'})`
    case 'user_deleted':
      return m.username ?? ''
    default:
      return ''
  }
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}
function meta(action: string) {
  return actionMeta[action] ?? { label: action, icon: 'pi pi-circle', cls: 'lg-gray' }
}

onMounted(() => {
  if (user.value?.role !== 'admin') return navigateTo('/')
  load(true)
})
</script>

<template>
  <div class="lg-page">
    <div class="lg-inner">
      <header class="lg-header">
        <h1 class="text-[22px] font-extrabold text-surface-900">Журнал действий</h1>
        <p class="text-[13.5px] text-surface-500 mt-1">История событий системы (хранится не менее 90 дней)</p>
      </header>

      <!-- Filters -->
      <div class="lg-filters">
        <div class="lg-ctl"><BaseSelect v-model="action" :options="actionOptions" /></div>
        <div class="lg-ctl"><BaseSelect v-model="actor" :options="actorOptions" /></div>
        <div class="lg-range"><BaseDatePicker v-model="range" selectionMode="range" placeholder="Период" dateFormat="d MM yy" /></div>
        <button v-if="hasFilter" class="lg-clear" type="button" @click="resetFilters">
          <i class="pi pi-times text-[11px]" /> Сбросить
        </button>
      </div>

      <!-- List -->
      <div v-if="rows.length === 0 && !loading" class="lg-empty">
        <i class="pi pi-history text-3xl opacity-30" />
        <div>{{ hasFilter ? 'Ничего не найдено' : 'Журнал пуст' }}</div>
      </div>

      <div v-else class="lg-list">
        <div v-for="log in rows" :key="log.id" class="lg-row">
          <span class="lg-icon" :class="meta(log.action).cls"><i :class="meta(log.action).icon" /></span>
          <div class="flex-1 min-w-0">
            <div class="lg-title">
              {{ meta(log.action).label }}
              <span v-if="log.clientName" class="lg-client">· {{ log.clientName }}</span>
            </div>
            <div v-if="describe(log)" class="lg-detail">{{ describe(log) }}</div>
          </div>
          <div class="lg-side">
            <span class="lg-actor">{{ log.actorName ?? 'Система' }}</span>
            <span class="lg-time">{{ fmtTime(log.createdAt) }}</span>
          </div>
        </div>

        <button v-if="hasMore" class="lg-more" :disabled="loading" @click="load(false)">
          {{ loading ? 'Загрузка…' : 'Показать ещё' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lg-page { height: 100%; overflow-y: auto; width: 100%; }
.lg-inner { max-width: 920px; margin: 0 auto; padding: 28px 28px 48px; width: 100%; }
.lg-header { margin-bottom: 18px; }

.lg-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 18px; }
.lg-ctl { width: 220px; }
.lg-range { min-width: 220px; }
.lg-clear {
  display: inline-flex; align-items: center; gap: 5px;
  height: 42px; padding: 0 14px;
  border-radius: 11px;
  font-size: 12.5px; font-weight: 600;
  color: var(--p-surface-500); background: var(--p-surface-100);
  border: 1.5px solid var(--p-surface-300);
}
.lg-clear:hover { background: var(--p-surface-200); color: var(--p-surface-800); }

.lg-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 56px 0; color: var(--p-surface-400); font-size: 14px;
}

.lg-list {
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 14px;
  overflow: hidden;
}
.lg-row {
  display: flex;
  gap: 12px;
  align-items: flex-start;
  padding: 13px 16px;
  border-top: 1px solid var(--p-surface-100);
}
.lg-row:first-child { border-top: none; }
.lg-icon {
  width: 34px; height: 34px;
  flex-shrink: 0;
  border-radius: 9px;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px;
}
.lg-primary { background: color-mix(in srgb, var(--p-primary-color) 14%, transparent); color: var(--p-primary-color); }
.lg-blue   { background: rgba(59,130,246,0.14); color: #2563eb; }
.lg-amber  { background: rgba(245,158,11,0.14); color: #d97706; }
.lg-green  { background: rgba(34,197,94,0.14); color: #16a34a; }
.lg-danger { background: rgba(239,68,68,0.14); color: #dc2626; }
.lg-gray   { background: var(--p-surface-100); color: var(--p-surface-500); }

.lg-title { font-size: 13.5px; font-weight: 600; color: var(--p-surface-900); }
.lg-client { font-weight: 500; color: var(--p-surface-500); }
.lg-detail { font-size: 12.5px; color: var(--p-surface-500); margin-top: 2px; line-height: 1.4; word-break: break-word; }
.lg-side { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; flex-shrink: 0; }
.lg-actor {
  font-size: 11.5px; font-weight: 600;
  color: var(--p-surface-600);
  background: var(--p-surface-100);
  padding: 2px 8px; border-radius: 6px;
  white-space: nowrap;
}
.lg-time { font-size: 11px; color: var(--p-surface-400); white-space: nowrap; }

.lg-more {
  width: 100%;
  padding: 12px;
  font-size: 13px;
  font-weight: 600;
  color: var(--p-primary-color);
  border-top: 1px solid var(--p-surface-100);
}
.lg-more:hover { background: var(--p-surface-50); }
</style>
