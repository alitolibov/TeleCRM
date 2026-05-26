<script setup lang="ts">
import EmployeeDialog from '~/components/employees/EmployeeDialog.vue'
import BaseConfirmDialog from '~/components/BaseConfirmDialog.vue'
import type { EmployeeWithStats, EmployeeCreate, EmployeeUpdate } from '~/composables/useEmployees'
import { initials, avatarColor } from '~/utils/format'

definePageMeta({ middleware: 'auth' })

const { user } = useAuth()
const { list, loading, load, create, update, remove, applyStatus } = useEmployees()
const { on, off } = useSocket()

// Admin-only — bounce non-admins back to chats.
onMounted(() => {
  if (user.value?.role !== 'admin') return navigateTo('/')
  load()
  const onStatus = (payload: any) => applyStatus(payload)
  on('user:status', onStatus)
  onUnmounted(() => off('user:status', onStatus))
})

// === Dialog state ===
const dialogOpen = ref(false)
const editing = ref<EmployeeWithStats | null>(null)
const saving = ref(false)
const dialogError = ref<string | null>(null)

function openCreate() {
  editing.value = null
  dialogError.value = null
  dialogOpen.value = true
}
function openEdit(emp: EmployeeWithStats) {
  editing.value = emp
  dialogError.value = null
  dialogOpen.value = true
}

async function onSubmit(payload: EmployeeCreate | (EmployeeUpdate & { id: string })) {
  saving.value = true
  dialogError.value = null
  try {
    if ('id' in payload && payload.id) {
      const { id, ...rest } = payload
      await update(id, rest)
    } else {
      await create(payload as EmployeeCreate)
    }
    dialogOpen.value = false
  } catch (e: any) {
    dialogError.value = e?.data?.message || e?.message || 'Ошибка'
  } finally {
    saving.value = false
  }
}

// === Delete confirmation ===
const deleteTarget = ref<EmployeeWithStats | null>(null)
const deleting = ref(false)

function askDelete(emp: EmployeeWithStats) { deleteTarget.value = emp }

async function confirmDelete() {
  if (!deleteTarget.value) return
  deleting.value = true
  try {
    await remove(deleteTarget.value.id)
    deleteTarget.value = null
  } catch (e: any) {
    alert(e?.data?.message || 'Не удалось удалить')
  } finally {
    deleting.value = false
  }
}

// === Filters ===
const filterRole = ref<'all' | 'admin' | 'manager'>('all')
const filterStatus = ref<'all' | 'online' | 'offline'>('all')

const filtered = computed(() => list.value.filter(e => {
  if (filterRole.value !== 'all' && e.role !== filterRole.value) return false
  if (filterStatus.value !== 'all' && e.status !== filterStatus.value) return false
  return true
}))

function formatLastSeen(iso: string | null) {
  if (!iso) return 'никогда'
  const d = new Date(iso)
  const diff = Date.now() - d.getTime()
  if (diff < 60_000) return 'только что'
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} мин назад`
  if (diff < 86_400_000) return `${Math.floor(diff / 3600_000)} ч назад`
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}

// Avatar color from username hash (deterministic, fits the existing palette).
function colorFromString(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return avatarColor(h)
}
</script>

<template>
  <div class="emp-page">
    <!-- Header -->
    <header class="emp-header">
      <div>
        <h1 class="text-[22px] font-extrabold text-surface-900">Сотрудники</h1>
        <p class="text-[13.5px] text-surface-500 mt-1">
          Управление учётными записями менеджеров и администраторов
        </p>
      </div>
      <Button label="Добавить" icon="pi pi-plus" @click="openCreate" />
    </header>

    <!-- Filters -->
    <div class="emp-filters">
      <div class="emp-filter-group">
        <span class="emp-filter-label">Роль</span>
        <div class="filter-bar">
          <button class="filter-pill" :class="{ 'filter-pill-active': filterRole === 'all' }" @click="filterRole = 'all'">Все</button>
          <button class="filter-pill" :class="{ 'filter-pill-active': filterRole === 'admin' }" @click="filterRole = 'admin'">Админы</button>
          <button class="filter-pill" :class="{ 'filter-pill-active': filterRole === 'manager' }" @click="filterRole = 'manager'">Менеджеры</button>
        </div>
      </div>
      <div class="emp-filter-group">
        <span class="emp-filter-label">Статус</span>
        <div class="filter-bar">
          <button class="filter-pill" :class="{ 'filter-pill-active': filterStatus === 'all' }" @click="filterStatus = 'all'">Все</button>
          <button class="filter-pill" :class="{ 'filter-pill-active': filterStatus === 'online' }" @click="filterStatus = 'online'">Online</button>
          <button class="filter-pill" :class="{ 'filter-pill-active': filterStatus === 'offline' }" @click="filterStatus = 'offline'">Offline</button>
        </div>
      </div>
    </div>

    <!-- Loading / Empty -->
    <div v-if="loading" class="emp-grid">
      <Skeleton v-for="i in 4" :key="i" height="140px" borderRadius="14px" />
    </div>
    <div v-else-if="filtered.length === 0" class="emp-empty">
      <i class="pi pi-users text-4xl opacity-30" />
      <p>Сотрудников не найдено</p>
    </div>

    <!-- Grid -->
    <div v-else class="emp-grid">
      <div
        v-for="emp in filtered" :key="emp.id"
        class="emp-card"
        :class="{ 'emp-card-online': emp.status === 'online' }"
      >
        <!-- Top: avatar + status -->
        <div class="emp-card-top">
          <div class="emp-avatar-wrap">
            <div class="avatar-circle lg" :class="colorFromString(emp.username)">
              {{ initials(emp.firstName, emp.lastName) }}
            </div>
            <span class="emp-status-dot" :class="emp.status === 'online' ? 'status-dot-online' : 'status-dot-offline'" />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-[15px] font-bold text-surface-900 truncate flex items-center gap-1.5">
              <span class="truncate">
                {{ emp.firstName }} {{ emp.lastName ?? '' }}
              </span>
              <span v-if="emp.id === user?.id" class="emp-you">(вы)</span>
              <span v-if="emp.status === 'online'" class="emp-online-badge">
                <span class="emp-online-pulse" />
                Online
              </span>
            </div>
            <div class="text-[12px] text-surface-500 mono truncate">@{{ emp.username }}</div>
          </div>
          <span class="emp-role-badge" :class="emp.role === 'admin' ? 'emp-role-admin' : 'emp-role-manager'">
            <i :class="emp.role === 'admin' ? 'pi pi-shield' : 'pi pi-user'" />
            {{ emp.role === 'admin' ? 'Админ' : 'Менеджер' }}
          </span>
        </div>

        <!-- Middle: stats -->
        <div class="emp-stats">
          <div class="emp-stat">
            <div class="emp-stat-value">{{ emp.activeChats }}</div>
            <div class="emp-stat-label">активных чатов</div>
          </div>
          <div class="emp-stat">
            <div class="emp-stat-value" :class="emp.status === 'online' ? 'text-green-600' : 'text-surface-500'">
              {{ emp.status === 'online' ? '●' : '○' }}
            </div>
            <div class="emp-stat-label">{{ formatLastSeen(emp.lastSeenAt) }}</div>
          </div>
        </div>

        <!-- Bottom: actions -->
        <div class="emp-card-actions">
          <Button label="Изменить" icon="pi pi-pencil" size="small" severity="secondary" outlined @click="openEdit(emp)" />
          <Button
            v-if="emp.id !== user?.id"
            icon="pi pi-trash"
            size="small"
            severity="danger"
            outlined
            @click="askDelete(emp)"
          />
        </div>
      </div>
    </div>

    <!-- Create/Edit dialog -->
    <EmployeeDialog
      v-model:open="dialogOpen"
      :employee="editing"
      :saving="saving"
      :error="dialogError"
      @submit="onSubmit"
    />

    <!-- Delete confirmation -->
    <BaseConfirmDialog
      :open="!!deleteTarget"
      icon="pi pi-trash"
      icon-variant="danger"
      title="Удалить сотрудника?"
      confirm-label="Удалить"
      confirm-variant="danger"
      :loading="deleting"
      @update:open="(v: boolean) => !v && (deleteTarget = null)"
      @confirm="confirmDelete"
    >
      <strong>{{ deleteTarget?.firstName }} {{ deleteTarget?.lastName ?? '' }}</strong>
      больше не сможет войти. История чатов и сообщений сохранится.
    </BaseConfirmDialog>
  </div>
</template>

<style scoped>
.emp-page {
  padding: 28px 28px 48px;
  max-width: 1100px;
  margin: 0 auto;
  width: 100%;
  height: 100%;
  overflow-y: auto;
}
.emp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
  gap: 16px;
}

.emp-filters {
  display: flex;
  gap: 24px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.emp-filter-group { display: flex; flex-direction: column; gap: 6px; }
.emp-filter-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--p-surface-400);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.emp-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}
.emp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 60px 0;
  color: var(--p-surface-400);
}

.emp-card {
  background: var(--p-surface-0);
  border: 1px solid var(--p-surface-200);
  border-radius: 14px;
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  transition: border-color 0.15s, transform 0.15s, background 0.15s;
  position: relative;
  overflow: hidden;
}
.emp-card:hover { border-color: var(--p-surface-300); }

/* Online state — green accent so admins can see who's available at a glance. */
.emp-card-online {
  border-color: color-mix(in srgb, #22c55e 35%, var(--p-surface-200));
  background: color-mix(in srgb, #22c55e 4%, var(--p-surface-0));
}
.emp-card-online:hover {
  border-color: color-mix(in srgb, #22c55e 55%, var(--p-surface-300));
}
.emp-card-online::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: #22c55e;
}

.emp-online-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 7px 2px 6px;
  border-radius: 6px;
  font-size: 10px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #15803d;
  background: color-mix(in srgb, #22c55e 16%, transparent);
  flex-shrink: 0;
}
.emp-online-pulse {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.6);
  animation: emp-online-pulse 1.8s ease-out infinite;
}
@keyframes emp-online-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.55); }
  70%  { box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
  100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
}

.emp-card-top { display: flex; align-items: center; gap: 12px; }
.emp-avatar-wrap { position: relative; flex-shrink: 0; }
.emp-status-dot {
  position: absolute;
  bottom: -1px; right: -1px;
  width: 14px; height: 14px;
  border-radius: 50%;
  border: 2.5px solid var(--p-surface-0);
}

.emp-you {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--p-primary-color);
  margin-left: 4px;
}

.emp-role-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 10px;
  border-radius: 8px;
  font-size: 11px;
  font-weight: 600;
  flex-shrink: 0;
}
.emp-role-badge > i { font-size: 11px; }
.emp-role-admin {
  color: #d97706;
  background: rgba(217, 119, 6, 0.12);
}
.emp-role-manager {
  color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
}

.emp-stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--p-surface-200);
  border-radius: 10px;
  overflow: hidden;
}
.emp-stat {
  padding: 10px 12px;
  background: var(--p-surface-50);
  display: flex;
  flex-direction: column;
  align-items: center;
}
.emp-stat-value {
  font-size: 17px;
  font-weight: 700;
  color: var(--p-surface-900);
}
.emp-stat-label {
  font-size: 11px;
  color: var(--p-surface-500);
  margin-top: 1px;
}

.emp-card-actions {
  display: flex;
  gap: 8px;
}
.emp-card-actions :deep(.p-button) { flex: 1; }
</style>
