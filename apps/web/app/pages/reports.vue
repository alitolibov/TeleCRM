<script setup lang="ts">
import BaseDatePicker from '~/components/BaseDatePicker.vue'

definePageMeta({ middleware: 'auth' })

interface EmployeeRow {
  userId: string; firstName: string; lastName: string | null
  activeChats: number; closedInPeriod: number
}
interface Report {
  closedChats: number; newClients: number
  avgFirstResponseSec: number | null; avgCloseSec: number | null
  byEmployee: EmployeeRow[]
}

const { user } = useAuth()
const { api } = useApi()

onMounted(() => {
  if (user.value?.role !== 'admin') return navigateTo('/')
  load()
})

type Period = 'today' | 'week' | 'month' | 'custom'
const period = ref<Period>('week')
const customRange = ref<Date[] | null>(null)
const report = ref<Report | null>(null)
const loading = ref(false)

const periods: { value: Period; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'custom', label: 'Период' },
]

function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d }
function rangeFor(p: Period): { from: Date; to: Date } | null {
  const to = new Date()
  if (p === 'today') return { from: startOfToday(), to }
  if (p === 'week') { const d = startOfToday(); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return { from: d, to } }
  if (p === 'month') { const d = startOfToday(); d.setDate(1); return { from: d, to } }
  // custom — needs a complete [start, end] range
  const r = customRange.value
  if (!r || !r[0] || !r[1]) return null
  const from = new Date(r[0]); from.setHours(0, 0, 0, 0)
  const end = new Date(r[1]); end.setHours(23, 59, 59, 999)
  return { from, to: end }
}

async function load() {
  const range = rangeFor(period.value)
  if (!range) return
  loading.value = true
  try {
    report.value = await api<Report>(`/reports?from=${range.from.toISOString()}&to=${range.to.toISOString()}`)
  } catch (e) { console.error(e) } finally { loading.value = false }
}

watch(period, (p) => { if (p !== 'custom') load() })
watch(customRange, () => { if (period.value === 'custom') load() })

/** Reset back to the default period (week) and clear the custom range. */
function resetPeriod() {
  customRange.value = null
  period.value = 'week'
}

function fmtDuration(sec: number | null): string {
  if (sec == null) return '—'
  if (sec < 60) return `${sec} сек`
  const m = Math.floor(sec / 60)
  if (m < 60) return `${m} мин ${sec % 60} сек`
  const h = Math.floor(m / 60)
  return `${h} ч ${m % 60} мин`
}

function initials(first: string, last: string | null) {
  return ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?'
}
</script>

<template>
  <div class="rep-page">
    <div class="rep-inner">
      <header class="rep-header">
        <div>
          <h1 class="text-[22px] font-extrabold text-surface-900">Отчёты</h1>
          <p class="text-[13.5px] text-surface-500 mt-1">Аналитика обработки чатов и нагрузки сотрудников</p>
        </div>
      </header>

      <!-- Period selector -->
      <div class="flex flex-wrap items-center gap-3 mb-5">
        <div class="filter-bar">
          <button
            v-for="p in periods" :key="p.value"
            class="filter-pill"
            :class="{ 'filter-pill-active': period === p.value }"
            type="button"
            @click="period = p.value"
          >{{ p.label }}</button>
        </div>
        <div v-if="period === 'custom'" class="flex items-center gap-2">
          <div class="rep-range">
            <BaseDatePicker
              v-model="customRange"
              selectionMode="range"
              placeholder="Выберите период"
              dateFormat="d MM yy"
            />
          </div>
          <button v-if="customRange?.length" class="rep-clear" type="button" @click="resetPeriod">
            <i class="pi pi-times text-[11px]" /> Сбросить
          </button>
        </div>
      </div>

      <!-- Summary cards -->
      <div class="rep-stats">
        <div class="rep-stat">
          <div class="rep-stat-icon" style="background: color-mix(in srgb, var(--p-primary-color) 14%, transparent); color: var(--p-primary-color)"><i class="pi pi-check-circle" /></div>
          <div class="rep-stat-value">{{ report?.closedChats ?? '—' }}</div>
          <div class="rep-stat-label">Обработано чатов</div>
        </div>
        <div class="rep-stat">
          <div class="rep-stat-icon" style="background: rgba(34,197,94,0.14); color: #16a34a"><i class="pi pi-users" /></div>
          <div class="rep-stat-value">{{ report?.newClients ?? '—' }}</div>
          <div class="rep-stat-label">Новых клиентов</div>
        </div>
        <div class="rep-stat">
          <div class="rep-stat-icon" style="background: rgba(245,158,11,0.14); color: #d97706"><i class="pi pi-bolt" /></div>
          <div class="rep-stat-value">{{ fmtDuration(report?.avgFirstResponseSec ?? null) }}</div>
          <div class="rep-stat-label">Ср. время первого ответа</div>
        </div>
        <div class="rep-stat">
          <div class="rep-stat-icon" style="background: rgba(59,130,246,0.14); color: #2563eb"><i class="pi pi-clock" /></div>
          <div class="rep-stat-value">{{ fmtDuration(report?.avgCloseSec ?? null) }}</div>
          <div class="rep-stat-label">Ср. время закрытия</div>
        </div>
      </div>

      <!-- Per-employee load -->
      <div class="rep-table-card">
        <div class="rep-table-head">Нагрузка по сотрудникам</div>
        <table class="rep-table">
          <thead>
            <tr>
              <th>Сотрудник</th>
              <th class="rep-col-num">Активных чатов</th>
              <th class="rep-col-num">Закрыто за период</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in report?.byEmployee ?? []" :key="e.userId">
              <td>
                <div class="flex items-center gap-2.5">
                  <span class="rep-avatar">{{ initials(e.firstName, e.lastName) }}</span>
                  <span class="font-medium text-surface-900">{{ e.firstName }} {{ e.lastName ?? '' }}</span>
                </div>
              </td>
              <td class="rep-col-num font-semibold">{{ e.activeChats }}</td>
              <td class="rep-col-num font-semibold">{{ e.closedInPeriod }}</td>
            </tr>
            <tr v-if="(report?.byEmployee?.length ?? 0) === 0">
              <td colspan="3" class="text-center text-surface-400 py-4">{{ loading ? 'Загрузка…' : 'Нет данных' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rep-page { height: 100%; overflow-y: auto; width: 100%; }
.rep-inner { max-width: 1000px; margin: 0 auto; padding: 28px 28px 48px; width: 100%; }
.rep-header { margin-bottom: 20px; }

.rep-range { min-width: 240px; }
.rep-clear {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--p-surface-500);
  background: var(--p-surface-100);
  transition: background 0.12s, color 0.12s;
}
.rep-clear:hover { background: var(--p-surface-200); color: var(--p-surface-800); }

.rep-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 14px;
  margin-bottom: 20px;
}
.rep-stat {
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 14px;
  padding: 18px;
}
.rep-stat-icon {
  width: 38px; height: 38px;
  border-radius: 10px;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
  margin-bottom: 12px;
}
.rep-stat-value { font-size: 24px; font-weight: 800; color: var(--p-surface-900); line-height: 1.1; }
.rep-stat-label { font-size: 12.5px; color: var(--p-surface-500); margin-top: 4px; }

.rep-table-card {
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 14px;
  overflow: hidden;
}
.rep-table-head {
  padding: 14px 18px;
  font-size: 14px;
  font-weight: 700;
  color: var(--p-surface-900);
  border-bottom: 1px solid var(--p-surface-200);
}
.rep-table { width: 100%; border-collapse: collapse; }
.rep-table th {
  text-align: left;
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--p-surface-400);
  padding: 10px 18px;
}
.rep-table td { padding: 12px 18px; border-top: 1px solid var(--p-surface-100); font-size: 13.5px; color: var(--p-surface-700); }
/* Numeric columns — header and value both centered, fixed width so they align */
.rep-col-num { text-align: center; width: 170px; }
.rep-avatar {
  width: 30px; height: 30px;
  flex-shrink: 0;
  border-radius: 9999px;
  display: flex; align-items: center; justify-content: center;
  font-size: 11px; font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, var(--p-primary-color), #a78bfa);
}
</style>
