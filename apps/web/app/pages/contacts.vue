<script setup lang="ts">
import { avatarColor, initials } from '~/utils/format'

definePageMeta({ middleware: 'auth' })

interface ContactRow {
  id: string
  firstName: string
  lastName: string | null
  addedAt: string
  chatId: string | null
  client: {
    id: string
    telegramId: number
    username: string | null
    phone: string | null
  }
  addedBy: {
    id: string
    firstName: string
    lastName: string | null
  }
}

const { api } = useApi()
const rows = ref<ContactRow[]>([])
const loading = ref(false)
const q = ref('')

async function load() {
  loading.value = true
  try {
    rows.value = await api<ContactRow[]>('/contacts')
  } catch (e) { console.error('[contacts] load failed', e) }
  finally { loading.value = false }
}
onMounted(load)

// Client-side filter — contacts list is small (manually added, not auto-grown).
const filtered = computed(() => {
  const needle = q.value.trim().toLowerCase()
  if (!needle) return rows.value
  return rows.value.filter((r) => {
    const name = `${r.firstName} ${r.lastName ?? ''}`.toLowerCase()
    return (
      name.includes(needle) ||
      r.client.username?.toLowerCase().includes(needle) ||
      r.client.phone?.includes(needle) ||
      String(r.client.telegramId).includes(needle)
    )
  })
})

/** Group rows by added-date for a clean Telegram-style daybook layout. */
const grouped = computed(() => {
  const groups: { label: string; items: ContactRow[] }[] = []
  for (const r of filtered.value) {
    const label = dayLabel(r.addedAt)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.items.push(r)
    else groups.push({ label, items: [r] })
  }
  return groups
})

function dayLabel(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (same(d, now)) return 'Сегодня'
  if (same(d, yesterday)) return 'Вчера'
  return d.toLocaleDateString('ru', {
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

function timeOnly(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
}

function openChat(row: ContactRow) {
  if (!row.chatId) return
  navigateTo({ path: '/', query: { chat: row.chatId } })
}
</script>

<template>
  <div class="contacts-page">
    <header class="contacts-header">
      <div>
        <h1 class="contacts-title">Контакты</h1>
        <p class="contacts-subtitle">
          Клиенты, добавленные сотрудниками. Имя из контакта используется в чатах и поиске.
        </p>
      </div>
      <div class="search-wrap">
        <i class="pi pi-search search-icon" />
        <input
          v-model="q"
          type="text"
          class="search-input"
          placeholder="Поиск по имени, @username, телефону..."
        />
        <button v-if="q" type="button" class="search-clear" @click="q = ''">
          <i class="pi pi-times" />
        </button>
      </div>
    </header>

    <div v-if="loading" class="contacts-state">
      <i class="pi pi-spin pi-spinner" />
    </div>
    <div v-else-if="rows.length === 0" class="contacts-state">
      <i class="pi pi-address-book text-4xl opacity-30" />
      <div class="text-surface-500 font-medium mt-2">Пока никого не добавили</div>
      <div class="text-[12.5px] text-surface-400 mt-1 max-w-md text-center">
        Открой чат с клиентом → справа есть кнопка «Добавить в контакты».
      </div>
    </div>
    <div v-else-if="filtered.length === 0" class="contacts-state">
      <i class="pi pi-search text-4xl opacity-30" />
      <div class="text-surface-500 font-medium mt-2">Ничего не найдено</div>
    </div>

    <div v-else class="contacts-list">
      <template v-for="group in grouped" :key="group.label">
        <div class="contacts-day">{{ group.label }}</div>
        <button
          v-for="row in group.items"
          :key="row.id"
          type="button"
          class="contact-card"
          :disabled="!row.chatId"
          @click="openChat(row)"
        >
          <div class="avatar-circle md" :class="avatarColor(row.client.telegramId)">
            {{ initials(row.firstName, row.lastName) }}
          </div>
          <div class="contact-main">
            <div class="contact-name">
              {{ row.firstName }} {{ row.lastName ?? '' }}
            </div>
            <div class="contact-sub">
              <span v-if="row.client.username" class="mono">@{{ row.client.username }}</span>
              <span v-else-if="row.client.phone" class="mono">{{ row.client.phone }}</span>
              <span v-else class="mono opacity-60">id: {{ row.client.telegramId }}</span>
            </div>
          </div>
          <div class="contact-meta">
            <div class="contact-meta-time">{{ timeOnly(row.addedAt) }}</div>
            <div class="contact-meta-author">
              <i class="pi pi-user-plus text-[10px]" />
              {{ row.addedBy.firstName }}
            </div>
          </div>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.contacts-page {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--p-surface-50);
}
.contacts-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 20px;
  padding: 22px 28px 18px;
  background: var(--p-surface-0);
  border-bottom: 1px solid var(--p-surface-200);
}
.contacts-title { font-size: 22px; font-weight: 800; color: var(--p-surface-900); }
.contacts-subtitle {
  font-size: 12.5px;
  color: var(--p-surface-500);
  margin-top: 4px;
  max-width: 560px;
}

.search-wrap {
  position: relative;
  width: 320px;
  max-width: 100%;
  flex-shrink: 0;
}
.search-icon {
  position: absolute;
  left: 12px; top: 50%;
  transform: translateY(-50%);
  font-size: 13px;
  color: var(--p-surface-400);
  pointer-events: none;
}
.search-input {
  width: 100%;
  height: 38px;
  padding: 0 36px;
  border-radius: 9999px;
  border: 1px solid var(--p-surface-200);
  background: var(--p-surface-0);
  font-size: 13px;
  outline: none;
  transition: border-color 0.1s;
}
.search-input:focus { border-color: var(--p-primary-color); }
.search-clear {
  position: absolute;
  right: 8px; top: 50%;
  transform: translateY(-50%);
  width: 22px; height: 22px;
  border-radius: 9999px;
  display: flex; align-items: center; justify-content: center;
  color: var(--p-surface-400);
}
.search-clear:hover { background: var(--p-surface-100); color: var(--p-surface-700); }

.contacts-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--p-surface-400);
  gap: 4px;
}
.contacts-state i { font-size: 28px; opacity: 0.5; }

.contacts-list {
  flex: 1;
  overflow-y: auto;
  padding: 14px 20px 24px;
  display: flex;
  flex-direction: column;
}
.contacts-day {
  font-size: 11px;
  font-weight: 700;
  color: var(--p-surface-400);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  padding: 14px 10px 6px;
}
.contact-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 14px;
  border-radius: 14px;
  background: var(--p-surface-0);
  margin-bottom: 6px;
  transition: background 0.1s, transform 0.1s;
  text-align: left;
  cursor: pointer;
  border: 1px solid transparent;
}
.contact-card:hover {
  background: color-mix(in srgb, var(--p-primary-color) 6%, var(--p-surface-0));
  border-color: color-mix(in srgb, var(--p-primary-color) 18%, transparent);
}
.contact-card:disabled { opacity: 0.55; cursor: default; }
.contact-card:disabled:hover {
  background: var(--p-surface-0);
  border-color: transparent;
}

.contact-main { flex: 1; min-width: 0; }
.contact-name {
  font-size: 14.5px;
  font-weight: 700;
  color: var(--p-surface-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.contact-sub {
  font-size: 12.5px;
  color: var(--p-surface-500);
  margin-top: 2px;
}

.contact-meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
  flex-shrink: 0;
}
.contact-meta-time {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--p-surface-500);
  font-variant-numeric: tabular-nums;
}
.contact-meta-author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--p-surface-400);
  background: var(--p-surface-100);
  padding: 2px 8px;
  border-radius: 9999px;
}
</style>
