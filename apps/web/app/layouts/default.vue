<template>
  <div class="flex h-screen overflow-hidden bg-surface-50">
    <!-- Sidebar -->
    <aside class="w-60 flex-shrink-0 flex flex-col bg-surface-0 border-r border-surface-200">
      <!-- Logo -->
      <div class="flex items-center gap-2.5 px-5 py-4 border-b border-surface-200">
        <div class="w-8 h-8 rounded-[9px] flex items-center justify-center text-white"
          style="background: linear-gradient(135deg, var(--p-primary-color) 0%, #a78bfa 100%); box-shadow: 0 4px 12px color-mix(in srgb, var(--p-primary-color) 35%, transparent)">
          <i class="pi pi-comments text-sm" />
        </div>
        <span class="text-[17px] font-extrabold tracking-tight">
          Tele<span class="text-primary">CRM</span>
        </span>
      </div>

      <!-- Nav -->
      <nav class="flex-1 flex flex-col gap-0.5 px-2.5 py-3 overflow-y-auto">
        <span class="text-[11px] font-semibold text-surface-400 uppercase tracking-widest px-2.5 py-2 mt-1">Работа</span>
        <NuxtLink to="/" class="nav-item" :class="{ 'nav-active': route.path === '/' }">
          <i class="pi pi-comments text-base" />
          Чаты
          <Badge v-if="totalUnread > 0" :value="totalUnread" class="ml-auto" />
        </NuxtLink>

        <span class="text-[11px] font-semibold text-surface-400 uppercase tracking-widest px-2.5 py-2 mt-2">Управление</span>
        <NuxtLink v-if="user?.role === 'admin'" to="/employees" class="nav-item" :class="{ 'nav-active': route.path === '/employees' }">
          <i class="pi pi-users text-base" />
          Сотрудники
        </NuxtLink>
        <NuxtLink to="/settings" class="nav-item" :class="{ 'nav-active': route.path === '/settings' }">
          <i class="pi pi-cog text-base" />
          Настройки
        </NuxtLink>
      </nav>

      <!-- Theme toggle -->
      <div class="mx-2 mb-2 p-1.5 bg-surface-100 rounded-xl flex gap-1 border border-surface-200">
        <button
          class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
          :class="theme === 'light' ? 'bg-surface-0 text-surface-900 shadow-sm' : 'text-surface-500'"
          @click="setTheme('light')"
        >
          <i class="pi pi-sun text-xs" /> Светлая
        </button>
        <button
          class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all"
          :class="theme === 'dark' ? 'bg-surface-0 text-surface-900 shadow-sm' : 'text-surface-500'"
          @click="setTheme('dark')"
        >
          <i class="pi pi-moon text-xs" /> Тёмная
        </button>
      </div>

      <!-- User card -->
      <div class="mx-2 mb-2 p-3 bg-surface-100 rounded-xl border border-surface-200">
        <!-- Top: avatar + name + logout -->
        <div class="flex items-center gap-2">
          <div class="relative flex-shrink-0">
            <Avatar :label="initials" shape="circle" size="normal"
              class="font-bold text-white"
              style="background: linear-gradient(135deg, var(--p-primary-color), #a78bfa)" />
            <span
              class="status-dot-presence"
              :class="isOnline ? 'status-dot-online' : 'status-dot-offline'"
            />
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-sm font-semibold truncate text-surface-900">{{ user?.firstName }}</div>
            <div class="text-[11px] text-surface-500">
              {{ user?.role === 'admin' ? 'Администратор' : 'Менеджер' }}
            </div>
          </div>
          <Button icon="pi pi-sign-out" text rounded size="small" severity="secondary"
            @click="logout" />
        </div>

        <!-- Bottom: explicit status switch row -->
        <div class="mt-2.5 pt-2.5 border-t border-surface-200 flex items-center justify-between gap-2">
          <div class="flex flex-col min-w-0">
            <span class="text-[12px] font-semibold" :class="isOnline ? 'text-green-600' : 'text-surface-500'">
              {{ isOnline ? 'Доступен' : 'Не доступен' }}
            </span>
            <span class="text-[10.5px] text-surface-400 leading-tight">
              {{ isOnline ? 'получаешь новые чаты' : 'новые чаты не придут' }}
            </span>
          </div>
          <ToggleSwitch
            :modelValue="isOnline"
            @update:modelValue="toggleStatus"
          />
        </div>
      </div>
    </aside>

    <!-- Main -->
    <main class="flex-1 overflow-hidden flex flex-col">
      <slot />
    </main>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { user, logout, getToken } = useAuth()
const { connect, on, off } = useSocket()
const chatsStore = useChatsStore()
const usersStore = useUsersStore()
const authStore = useAuthStore()
const { loadMe, loadAll, setStatus, setupRealtime } = useUserStatus()
const push = usePushNotifications()
const theme = inject<Ref<string>>('theme')!

const totalUnread = computed(() => chatsStore.totalUnread)
const initials = computed(() => (user.value?.firstName ?? '').slice(0, 2).toUpperCase())

// Unread counter in the browser tab title (spec 10.1).
useHead({
  title: computed(() => totalUnread.value > 0 ? `(${totalUnread.value}) TeleCRM` : 'TeleCRM'),
})

// Live status comes from usersStore.me — kept in sync with `user:status` WS events.
const isOnline = computed(() => usersStore.me?.status === 'online')

async function toggleStatus(next: boolean) {
  try { await setStatus(next ? 'online' : 'offline') } catch (e) { console.error(e) }
}

function setTheme(t: string) { theme.value = t }

// Server pushed `auth:revoked` — admin deleted us. Kick to /login immediately.
function onAuthRevoked() {
  authStore.clear()
  navigateTo('/login')
}

onMounted(async () => {
  // Defensive: ensure socket is connected before subscribing/heartbeating.
  // The page-level connect() may or may not run first depending on route.
  const token = getToken()
  if (token) connect(token)
  await loadMe()
  // Also load the full user directory so chat-list can resolve `senderId`
  // → firstName for "Имя: текст" preview when admin views chats handled by others.
  loadAll().catch(() => {})
  setupRealtime()
  push.init().catch(() => {})   // register service worker + sync push subscription
  on('auth:revoked', onAuthRevoked)
})

onUnmounted(() => {
  off('auth:revoked', onAuthRevoked)
})
</script>

<style scoped>
.nav-item {
  @apply flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-surface-500 font-medium text-[13.5px] transition-all no-underline relative;
}
.nav-item:hover { @apply bg-surface-100 text-surface-800; }
.nav-active {
  @apply bg-primary-50 text-primary-600 font-semibold;
}
.nav-active::before {
  content: '';
  @apply absolute -left-2.5 top-2 bottom-2 w-0.5 bg-primary-600 rounded-r;
}

/* Presence dot on the user avatar (bottom-right corner). */
.status-dot-presence {
  position: absolute;
  bottom: -1px;
  right: -1px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--p-surface-100);
}
.status-dot-online  { background: #22c55e; }
.status-dot-offline { background: #94a3b8; }

</style>
