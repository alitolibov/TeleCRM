<template>
  <div :data-theme="theme" style="height: 100%">
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>

    <!-- Custom-styled, clickable toasts (escalations / transfers) -->
    <Toast position="top-right">
      <template #container="{ message, closeCallback }">
        <div
          class="app-toast"
          :class="[`app-toast-${message.severity}`, message.data?.chatId ? 'app-toast-clickable' : '']"
          @click="onToastClick(message, closeCallback)"
        >
          <span class="app-toast-icon">
            <i :class="toastIcon(message.severity)" />
          </span>
          <div class="app-toast-body">
            <div class="app-toast-title">{{ message.summary }}</div>
            <div v-if="message.detail" class="app-toast-detail">{{ message.detail }}</div>
            <div v-if="message.data?.chatId" class="app-toast-action">Открыть чат →</div>
          </div>
          <button class="app-toast-close" type="button" @click.stop="closeCallback">
            <i class="pi pi-times" />
          </button>
        </div>
      </template>
    </Toast>

    <ConfirmDialog />
  </div>
</template>

<script setup lang="ts">
const theme = useCookie('theme', { default: () => 'light' })
provide('theme', theme)

useHead({
  htmlAttrs: computed(() => ({ 'data-theme': theme.value })),
})

function toastIcon(severity?: string) {
  if (severity === 'error') return 'pi pi-exclamation-circle'
  if (severity === 'warn') return 'pi pi-exclamation-triangle'
  if (severity === 'success') return 'pi pi-check-circle'
  return 'pi pi-bell'
}

const { requestOpen } = useChatNavigation()

function onToastClick(message: { data?: { chatId?: string } }, close?: () => void) {
  const chatId = message.data?.chatId
  if (!chatId) return
  // Always navigate so a /settings → / round-trip lands at the right URL.
  navigateTo({ path: '/', query: { chat: chatId } })
  // Signal the page directly too — if /?chat=ID is already the URL (common for
  // "unclosed" escalations where the chat is already open), the router
  // wouldn't fire any watcher, so the page would otherwise sit idle.
  requestOpen(chatId)
  close?.()
}
</script>

<style>
/* Strip PrimeVue's default toast chrome — the #container slot fully owns the look */
.p-toast { width: 360px; max-width: 92vw; }
.p-toast-message {
  background: transparent !important;
  border: none !important;
  box-shadow: none !important;
  padding: 0 !important;
  margin: 0 0 12px 0 !important;
}

/* Custom toast card */
.app-toast {
  position: relative;
  display: flex;
  gap: 12px;
  width: 100%;
  padding: 14px 16px;
  border-radius: 14px;
  background: var(--p-surface-0);
  border: 1px solid var(--divider);
  border-left: 4px solid var(--p-surface-400);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.22);
}
.app-toast-clickable { cursor: pointer; transition: transform 0.12s; }
.app-toast-clickable:hover { transform: translateY(-1px); }
.app-toast-warn  { border-left-color: #f59e0b; }
.app-toast-error { border-left-color: #ef4444; }
.app-toast-info  { border-left-color: var(--p-primary-color); }
.app-toast-success { border-left-color: #22c55e; }

.app-toast-icon {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 15px;
  background: var(--p-surface-100);
  color: var(--p-surface-600);
}
.app-toast-warn  .app-toast-icon { background: rgba(245, 158, 11, 0.15); color: #d97706; }
.app-toast-error .app-toast-icon { background: rgba(239, 68, 68, 0.15); color: #dc2626; }
.app-toast-info  .app-toast-icon { background: color-mix(in srgb, var(--p-primary-color) 14%, transparent); color: var(--p-primary-color); }
.app-toast-success .app-toast-icon { background: rgba(34, 197, 94, 0.15); color: #16a34a; }

.app-toast-body { flex: 1; min-width: 0; padding-right: 18px; }
.app-toast-title { font-size: 14px; font-weight: 700; color: var(--p-surface-900); }
.app-toast-detail { font-size: 12.5px; color: var(--p-surface-600); margin-top: 2px; line-height: 1.4; }
.app-toast-action { font-size: 12px; font-weight: 600; color: var(--p-primary-color); margin-top: 6px; }
.app-toast-close {
  position: absolute;
  top: 8px; right: 8px;
  width: 22px; height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9999px;
  color: var(--p-surface-400);
  font-size: 11px;
  transition: background 0.12s, color 0.12s;
}
.app-toast-close:hover { background: var(--p-surface-100); color: var(--p-surface-700); }
</style>
