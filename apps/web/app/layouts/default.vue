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
      <div class="mx-2 mb-2 px-3 py-2.5 bg-surface-100 rounded-xl border border-surface-200 flex items-center gap-2">
        <Avatar :label="initials" shape="circle" size="normal"
          class="font-bold text-white flex-shrink-0"
          style="background: linear-gradient(135deg, var(--p-primary-color), #a78bfa)" />
        <div class="flex-1 min-w-0">
          <div class="text-sm font-semibold truncate text-surface-900">{{ user?.firstName }}</div>
          <div class="text-[11.5px] text-surface-500 flex items-center gap-1">
            <span class="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
            {{ user?.role === 'admin' ? 'Администратор' : 'Менеджер' }}
          </div>
        </div>
        <Button icon="pi pi-sign-out" text rounded size="small" severity="secondary"
          v-tooltip.top="'Выйти'" @click="logout" />
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
const { user, logout } = useAuth()
const chatsStore = useChatsStore()
const theme = inject<Ref<string>>('theme')!

const totalUnread = computed(() => chatsStore.totalUnread)
const initials = computed(() => (user.value?.firstName ?? '').slice(0, 2).toUpperCase())

function setTheme(t: string) { theme.value = t }
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
</style>
