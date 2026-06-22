<script setup lang="ts">
import BaseDatePicker from '~/components/BaseDatePicker.vue'
import BaseSelect from '~/components/BaseSelect.vue'
import { avatarColor, initials } from '~/utils/format'

definePageMeta({ middleware: 'auth' })

interface ResultRow {
  chatId: string
  status: 'new' | 'active' | 'closed'
  client: { firstName: string; lastName: string | null; username: string | null; telegramId: number }
  manager: { id: string; firstName: string } | null
  clientStatus: string
  flight: string | null
  dates: string | null
  amount: string | null
  comment: string | null
  closedAt: string
}

const { user } = useAuth()
const { api } = useApi()
const usersStore = useUsersStore()

const isAdmin = computed(() => user.value?.role === 'admin')

const { items: closeReasons, load: loadCloseReasons, labelOf: statusLabel } = useCloseReasons()

const q = ref('')
const status = ref('')
const manager = ref('')
const range = ref<Date[] | null>(null)
const rows = ref<ResultRow[]>([])
const loading = ref(false)

const hasFilter = computed(() => !!(q.value.trim() || status.value || manager.value || range.value?.length))

const statusOptions = computed(() => [
  { label: 'Все статусы', value: '' },
  ...closeReasons.value.map(r => ({ value: r.value, label: r.label })),
])
const managerOptions = computed(() => [
  { label: 'Все менеджеры', value: '' },
  ...usersStore.all.map(u => ({ value: u.id, label: `${u.firstName} ${u.lastName ?? ''}`.trim() })),
])

function buildQuery(): string {
  const p = new URLSearchParams()
  if (q.value.trim()) p.set('q', q.value.trim())
  if (status.value) p.set('clientStatus', status.value)
  if (manager.value) p.set('assignedTo', manager.value)
  const r = range.value
  if (r?.[0] && r[1]) {
    const from = new Date(r[0]); from.setHours(0, 0, 0, 0)
    const to = new Date(r[1]); to.setHours(23, 59, 59, 999)
    p.set('dateFrom', from.toISOString())
    p.set('dateTo', to.toISOString())
  }
  return p.toString()
}

async function load() {
  loading.value = true
  try {
    rows.value = await api<ResultRow[]>(`/chats/results?${buildQuery()}`)
  } catch (e) { console.error(e) } finally { loading.value = false }
}

let timer: ReturnType<typeof setTimeout> | null = null
watch([q, status, manager, range], () => {
  if (timer) clearTimeout(timer)
  timer = setTimeout(load, 250)
})

function resetFilters() {
  q.value = ''; status.value = ''; manager.value = ''; range.value = null
}

const { requestOpen: requestOpenChat } = useChatNavigation()
async function openChat(id: string) {
  // Await the navigation so index.vue is mounted (and its pendingOpen watcher
  // registered) BEFORE we fire requestOpen — otherwise the signal is set while
  // we're still on /results and the not-yet-mounted watcher misses it. The
  // immediate route.query.chat watcher alone no-ops when the clicked chat is
  // already the active one in the persisted store, so some cards looked dead.
  await navigateTo({ path: '/', query: { chat: id } })
  requestOpenChat(id)
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

onMounted(() => {
  loadCloseReasons()
  load()
})   // user directory is loaded app-wide by the layout
</script>

<template>
  <div class="res-page">
    <div class="res-inner">
      <header class="res-header">
        <h1 class="text-[22px] font-extrabold text-surface-900">Результаты</h1>
        <p class="text-[13.5px] text-surface-500 mt-1">Закрытые чаты с зафиксированным результатом</p>
      </header>

      <!-- Filters -->
      <div class="res-filters">
        <div class="res-search">
          <i class="pi pi-search res-search-icon" />
          <input v-model="q" type="text" placeholder="Поиск по рейсу, сумме, комментарию…" class="res-search-input" />
          <button v-if="q" class="res-search-clear" type="button" @click="q = ''"><i class="pi pi-times" /></button>
        </div>
        <div class="res-ctl"><BaseSelect v-model="status" :options="statusOptions" /></div>
        <div v-if="isAdmin" class="res-ctl"><BaseSelect v-model="manager" :options="managerOptions" /></div>
        <div class="res-range">
          <BaseDatePicker v-model="range" selectionMode="range" placeholder="Дата закрытия" dateFormat="d MM yy" />
        </div>
        <button v-if="hasFilter" class="res-clear" type="button" @click="resetFilters">
          <i class="pi pi-times text-[11px]" /> Сбросить
        </button>
      </div>

      <!-- List -->
      <div v-if="loading" class="res-empty">Загрузка…</div>
      <div v-else-if="rows.length === 0" class="res-empty">
        <i class="pi pi-inbox text-3xl opacity-30" />
        <div>{{ hasFilter ? 'Ничего не найдено' : 'Пока нет закрытых чатов' }}</div>
      </div>

      <div v-else class="res-list">
        <button v-for="r in rows" :key="r.chatId" class="res-card" @click="openChat(r.chatId)">
          <div class="avatar-circle md" :class="avatarColor(r.client.telegramId)">
            {{ initials(r.client.firstName, r.client.lastName) }}
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-[14.5px] text-surface-900 truncate">
                {{ r.client.firstName }} {{ r.client.lastName ?? '' }}
              </span>
              <span class="status-pill" :class="`status-pill-${r.clientStatus}`">{{ statusLabel(r.clientStatus) }}</span>
              <span v-if="r.status !== 'closed'" class="res-reopened">переоткрыт</span>
            </div>
            <div class="res-meta">
              <span v-if="r.flight"><i class="pi pi-send text-[11px]" /> {{ r.flight }}</span>
              <span v-if="r.dates"><i class="pi pi-calendar text-[11px]" /> {{ r.dates }}</span>
              <span v-if="r.amount"><i class="pi pi-dollar text-[11px]" /> {{ r.amount }}</span>
            </div>
            <div v-if="r.comment" class="res-comment">{{ r.comment }}</div>
          </div>
          <div class="res-side">
            <span v-if="r.manager" class="res-manager">{{ r.manager.firstName }}</span>
            <span class="res-date">{{ fmtDate(r.closedAt) }}</span>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.res-page { height: 100%; overflow-y: auto; width: 100%; }
.res-inner { max-width: 1000px; margin: 0 auto; padding: 28px 28px 48px; width: 100%; }
.res-header { margin-bottom: 18px; }

.res-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  margin-bottom: 18px;
}
/* Search — same bordered look as the date picker / selects */
.res-search {
  position: relative;
  flex: 1;
  min-width: 240px;
}
.res-search-icon {
  position: absolute;
  left: 13px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--p-surface-400);
  font-size: 13px;
  pointer-events: none;
}
.res-search-input {
  width: 100%;
  height: 42px;
  background: var(--p-surface-100);
  border: 1.5px solid var(--p-surface-300);
  border-radius: 11px;
  padding: 0 36px 0 36px;
  font-size: 13.5px;
  color: var(--p-surface-900);
  outline: none;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.res-search-input::placeholder { color: var(--p-surface-400); }
.res-search-input:focus {
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}
.res-search-clear {
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-surface-500);
  background: color-mix(in srgb, var(--p-surface-900) 8%, transparent);
  font-size: 10px;
}
.res-search-clear:hover { background: color-mix(in srgb, var(--p-surface-900) 14%, transparent); }
.res-ctl { width: 190px; }
.res-range { min-width: 220px; }
.res-clear {
  display: inline-flex; align-items: center; gap: 5px;
  height: 42px; padding: 0 14px;
  border-radius: 11px;
  font-size: 12.5px; font-weight: 600;
  color: var(--p-surface-500);
  background: var(--p-surface-100);
  border: 1.5px solid var(--p-surface-300);
}
.res-clear:hover { background: var(--p-surface-200); color: var(--p-surface-800); }

.res-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 10px; padding: 56px 0;
  color: var(--p-surface-400); font-size: 14px;
}

.res-list { display: flex; flex-direction: column; gap: 10px; }
.res-card {
  display: flex;
  gap: 13px;
  align-items: flex-start;
  text-align: left;
  padding: 15px 16px;
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 14px;
  transition: border-color 0.15s, background 0.15s;
}
.res-card:hover { border-color: var(--p-surface-300); background: var(--p-surface-50); }
.res-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}
.res-meta span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: 7px;
  background: var(--p-surface-100);
  font-size: 12px;
  font-weight: 500;
  color: var(--p-surface-600);
}
.res-meta span > i { opacity: 0.7; }
.res-comment {
  margin-top: 8px;
  font-size: 12.5px;
  color: var(--p-surface-500);
  line-height: 1.45;
}
.res-side {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}
.res-manager {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  padding: 2px 8px;
  border-radius: 6px;
}
.res-date { font-size: 11px; color: var(--p-surface-400); white-space: nowrap; }
.res-reopened {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--p-orange-500, #f97316);
  background: color-mix(in srgb, var(--p-orange-500, #f97316) 14%, transparent);
  padding: 1px 7px;
  border-radius: 6px;
}
</style>
