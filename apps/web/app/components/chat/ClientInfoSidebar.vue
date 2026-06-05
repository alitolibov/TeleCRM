<script setup lang="ts">
import type { Chat } from '~/stores/chats'
import AddContactDialog, { type AddContactPayload } from '~/components/chat/dialogs/AddContactDialog.vue'
import ClientMediaTab from '~/components/chat/ClientMediaTab.vue'
import { avatarColor, initials } from '~/utils/format'

const props = defineProps<{
  chat: Chat
  info: any | null
}>()

const emit = defineEmits<{
  /** Jump to a specific message in (potentially) a different chat of this client. */
  (e: 'open-message', payload: { chatId: string; messageId: string }): void
}>()

// "Инфо" by default; resets to it each time the chat changes so navigating to
// another client doesn't strand the user on a "Медиа" tab that's still loading.
type Tab = 'info' | 'media'
const tab = ref<Tab>('info')
watch(() => props.chat.id, () => { tab.value = 'info' })

// === Saved-contact state for the current chat's client ===
// One in-flight request per chat-switch; the row is refreshed after add/edit
// so the button label flips immediately.
const { api } = useApi()
const toast = useToast()
const contact = ref<{ id: string; firstName: string; lastName: string | null } | null>(null)
const contactLoading = ref(false)
const dialogOpen = ref(false)
const dialogSaving = ref(false)

const contactBtnLabel = computed(() => {
  if (props.chat.inTelegramContacts) return 'В контактах'
  if (contact.value) return 'Сохранено в CRM'
  return 'Добавить в контакты'
})
const contactBtnIcon = computed(() => {
  if (props.chat.inTelegramContacts) return 'pi pi-check-circle'
  if (contact.value) return 'pi pi-bookmark-fill'
  return 'pi pi-user-plus'
})
const contactBtnClass = computed(() => {
  if (props.chat.inTelegramContacts) return 'contact-action-saved'
  if (contact.value) return 'contact-action-crm'
  return 'contact-action-primary'
})

async function refreshContact(clientId: string) {
  contactLoading.value = true
  try {
    // Server answers `null` (with 200) when the client isn't a saved
    // contact — see /contacts/by-client. No 404 noise in dev tools.
    contact.value = await api(`/contacts/by-client/${clientId}`)
  } catch (e) {
    console.error('[contacts] status probe failed', e)
    contact.value = null
  } finally {
    contactLoading.value = false
  }
}

watch(
  () => props.chat.client.id,
  (id) => { if (id) refreshContact(id) },
  { immediate: true },
)

async function onConfirm(payload: AddContactPayload) {
  const wasEditing = !!contact.value
  dialogSaving.value = true
  try {
    // Strip empty phone — server's DTO tolerates it now, but sending '' would
    // still trigger spurious phone-side logic if anyone adds it later.
    const body: Record<string, unknown> = {
      chatId: props.chat.id,
      firstName: payload.firstName,
      lastName: payload.lastName,
    }
    if (payload.phone) body.phone = payload.phone
    const row = await api<{ id: string; firstName: string; lastName: string | null }>(
      '/contacts',
      { method: 'POST', body },
    )
    contact.value = row
    // Write-through on the server updates clients.first/last_name/phone —
    // mirror it locally so the header, chat list and sidebar re-render
    // without a refetch.
    props.chat.client.firstName = row.firstName
    props.chat.client.lastName = row.lastName ?? undefined
    if (payload.phone) props.chat.client.phone = payload.phone
    props.chat.hasCrmContact = true
    // We've enqueued addContact to TG with a phone, flip the TG-side flag
    // optimistically so the button switches to "В контактах" without waiting.
    if (payload.phone) props.chat.inTelegramContacts = true
    dialogOpen.value = false
    toast.add({
      severity: 'success',
      summary: wasEditing ? 'Контакт обновлён' : 'Контакт добавлен',
      detail: payload.phone
        ? 'Появится и в Telegram через пару секунд.'
        : undefined,
      life: 3000,
    })
  } catch (e) {
    console.error('[contacts] save failed', e)
    toast.add({ severity: 'error', summary: 'Не удалось сохранить контакт', life: 4000 })
  } finally {
    dialogSaving.value = false
  }
}

// Admin-managed list (close_reasons table) — load once and reuse the in-memory
// store across renders.
const { labelOf: statusLabel, load: loadCloseReasons } = useCloseReasons()
onMounted(() => loadCloseReasons())

function formatDate(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString()) {
    return `Сегодня, ${d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`
  }
  return d.toLocaleDateString('ru', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

/** Like formatDate but always includes the time — used for history events. */
function formatDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const time = d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `Сегодня, ${time}`
  const date = d.toLocaleDateString('ru', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
  return `${date}, ${time}`
}
</script>

<template>
  <aside class="client-panel">
    <!-- Avatar + name + contact action (Telegram-style) -->
    <div class="flex flex-col items-center text-center pt-7 pb-5 px-5">
      <div class="avatar-circle lg" :class="avatarColor(chat.client.telegramId)">
        {{ initials(chat.client.firstName, chat.client.lastName) }}
      </div>
      <div class="mt-3 text-[17px] font-bold text-surface-900">
        {{ chat.client.firstName }} {{ chat.client.lastName ?? '' }}
      </div>
      <div v-if="!contact" class="mt-0.5 text-[12.5px] text-surface-400 mono">
        {{ chat.client.username ? `@${chat.client.username}` : `id: ${chat.client.telegramId}` }}
      </div>

      <!-- Three states so the team can tell where things stand:
           · TG knows them          → "В контактах ✎"   (full match)
           · only CRM knows them    → "Сохранено в CRM ✎" (custom name set,
              but no phone, so TG-side wasn't touched)
           · neither                → "Добавить в контакты" (primary CTA) -->
      <button
        v-if="!contactLoading"
        class="contact-action"
        :class="contactBtnClass"
        type="button"
        @click="dialogOpen = true"
      >
        <i :class="contactBtnIcon" />
        <span>{{ contactBtnLabel }}</span>
        <i v-if="chat.inTelegramContacts || contact" class="pi pi-pencil contact-action-edit" />
      </button>
    </div>

    <!-- Tab switcher -->
    <div class="tab-bar">
      <button
        type="button"
        class="tab-btn"
        :class="{ 'tab-btn-active': tab === 'info' }"
        @click="tab = 'info'"
      >Инфо</button>
      <button
        type="button"
        class="tab-btn"
        :class="{ 'tab-btn-active': tab === 'media' }"
        @click="tab = 'media'"
      >Медиа</button>
    </div>

    <!-- Media tab: photos & videos from every chat with this client -->
    <ClientMediaTab
      v-if="tab === 'media'"
      :chat-id="chat.id"
      @open="(p) => emit('open-message', p)"
    />

    <!-- Info tab content (default) -->
    <template v-else>
    <!-- Info block -->
    <div class="px-5 py-4">
      <div class="info-title">Информация</div>
      <dl class="space-y-2.5 mt-3">
        <div v-if="chat.client.phone" class="flex justify-between items-center text-[13px]">
          <dt class="text-surface-500">Телефон</dt>
          <dd class="font-semibold mono">{{ chat.client.phone }}</dd>
        </div>
        <div v-if="!chat.client.phone && chat.client.username" class="flex justify-between items-center text-[13px]">
          <dt class="text-surface-500">Username</dt>
          <dd class="font-semibold mono">@{{ chat.client.username }}</dd>
        </div>
        <div class="flex justify-between items-center text-[13px]">
          <dt class="text-surface-500">Telegram ID</dt>
          <dd class="font-semibold mono">{{ chat.client.telegramId }}</dd>
        </div>
        <div v-if="info" class="flex justify-between items-center text-[13px]">
          <dt class="text-surface-500">Первое обращение</dt>
          <dd class="font-semibold">{{ formatDate(info.firstContactAt) }}</dd>
        </div>
        <div v-if="info?.assignedUser" class="flex justify-between items-center text-[13px]">
          <dt class="text-surface-500">Менеджер</dt>
          <dd class="font-semibold flex items-center gap-1.5">
            <span class="avatar-circle xs purple">{{ info.assignedUser.firstName?.[0]?.toUpperCase() ?? '?' }}</span>
            {{ info.assignedUser.firstName }}
          </dd>
        </div>
      </dl>
    </div>

    <div v-if="info?.latestStatus || info?.currentChatResult" class="info-divider" />

    <!-- Client status -->
    <div v-if="info?.latestStatus || info?.currentChatResult" class="px-5 py-4">
      <div class="info-title">Статус клиента</div>
      <div class="mt-3">
        <span class="status-pill" :class="`status-pill-${info.currentChatResult?.clientStatus ?? info.latestStatus}`">
          <i class="pi pi-clock text-[10px]" />
          {{ statusLabel(info.currentChatResult?.clientStatus ?? info.latestStatus) }}
        </span>
        <p v-if="info.currentChatResult?.comment" class="mt-3 text-[13px] text-surface-600 leading-relaxed">
          {{ info.currentChatResult.comment }}
        </p>
        <div v-if="info.currentChatResult?.flight || info.currentChatResult?.dates" class="mt-3 space-y-1 text-[12.5px]">
          <div v-if="info.currentChatResult?.flight" class="flex gap-2">
            <span class="text-surface-400">Рейс:</span>
            <span class="font-medium">{{ info.currentChatResult.flight }}</span>
          </div>
          <div v-if="info.currentChatResult?.dates" class="flex gap-2">
            <span class="text-surface-400">Даты:</span>
            <span class="font-medium">{{ info.currentChatResult.dates }}</span>
          </div>
          <div v-if="info.currentChatResult?.amount" class="flex gap-2">
            <span class="text-surface-400">Сумма:</span>
            <span class="font-medium">${{ info.currentChatResult.amount }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="info?.timeline?.length" class="info-divider" />

    <!-- History timeline -->
    <div v-if="info?.timeline?.length" class="px-5 py-4">
      <div class="info-title">История</div>
      <ul class="mt-3 space-y-3.5">
        <li v-for="(t, idx) in info.timeline" :key="idx" class="flex gap-3">
          <span
            class="history-dot"
            :class="t.type === 'closed' ? `status-dot-${t.clientStatus}` :
                    t.type === 'reopened' ? 'bg-primary-400' :
                    t.type === 'taken' ? 'bg-green-500' :
                    t.type === 'transferred' ? 'bg-primary-500' : 'bg-surface-300'"
          />
          <div class="flex-1 min-w-0">
            <template v-if="t.type === 'closed'">
              <div class="text-[13.5px] font-semibold">
                {{ statusLabel(t.clientStatus) }}{{ t.flight ? ` · ${t.flight}` : '' }}
              </div>
              <div class="text-[11.5px] text-surface-400 mt-0.5">
                Закрыт · {{ formatDateTime(t.date) }}<span v-if="t.amount"> · ${{ t.amount }}</span>
              </div>
            </template>
            <template v-else-if="t.type === 'reopened'">
              <div class="text-[13.5px] font-semibold">Возобновлён</div>
              <div class="text-[11.5px] text-surface-400 mt-0.5">{{ formatDateTime(t.date) }}</div>
            </template>
            <template v-else-if="t.type === 'taken'">
              <div class="text-[13.5px] font-semibold">Взят в работу</div>
              <div class="text-[11.5px] text-surface-400 mt-0.5">{{ formatDateTime(t.date) }}</div>
            </template>
            <template v-else-if="t.type === 'transferred'">
              <div class="text-[13.5px] font-semibold">
                {{ t.mode === 'queue'
                  ? `Возвращён в очередь${t.fromName ? ` (${t.fromName})` : ''}`
                  : `Передан${t.fromName ? ` от ${t.fromName}` : ''}${t.toName ? ` → ${t.toName}` : ''}` }}
              </div>
              <div v-if="t.comment" class="text-[12px] text-surface-500 mt-0.5 break-words">{{ t.comment }}</div>
              <div class="text-[11.5px] text-surface-400 mt-0.5">{{ formatDateTime(t.date) }}</div>
            </template>
            <template v-else>
              <div class="text-[13.5px] font-semibold">Первое обращение</div>
              <div class="text-[11.5px] text-surface-400 mt-0.5">{{ formatDate(t.date) }}</div>
            </template>
          </div>
        </li>
      </ul>
    </div>
    </template>
  </aside>

  <AddContactDialog
    :open="dialogOpen"
    :editing="!!contact"
    :initial-first-name="contact?.firstName ?? chat.client.firstName"
    :initial-last-name="contact?.lastName ?? chat.client.lastName"
    :initial-phone="chat.client.phone"
    :saving="dialogSaving"
    @update:open="(v) => dialogOpen = v"
    @confirm="onConfirm"
  />
</template>

<style scoped>
.contact-action {
  margin-top: 14px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 9999px;
  font-size: 13px;
  font-weight: 600;
  transition: filter 0.1s, background 0.1s;
  cursor: pointer;
}
.contact-action-primary {
  background: var(--p-primary-color);
  color: var(--p-primary-contrast-color, #fff);
}
.contact-action-primary:hover { filter: brightness(1.06); }
.contact-action-saved {
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  color: var(--p-primary-color);
}
.contact-action-saved:hover {
  background: color-mix(in srgb, var(--p-primary-color) 20%, transparent);
}
/* CRM-only — saved here but never made it to Telegram (no phone given).
   Muted neutral so it doesn't compete with the primary "Add" button. */
.contact-action-crm {
  background: var(--p-surface-100);
  color: var(--p-surface-700);
}
.contact-action-crm:hover { background: var(--p-surface-200); }
.contact-action i { font-size: 13px; }
.contact-action-edit { opacity: 0.55; margin-left: 2px; }

.tab-bar {
  display: flex;
  border-top: 1px solid var(--divider);
  border-bottom: 1px solid var(--divider);
  background: var(--p-surface-0);
}
.tab-btn {
  flex: 1;
  padding: 11px 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--p-surface-500);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.12s, border-color 0.12s, background 0.12s;
}
.tab-btn:hover { background: var(--p-surface-50); color: var(--p-surface-700); }
.tab-btn-active {
  color: var(--p-primary-color);
  border-bottom-color: var(--p-primary-color);
}
.tab-btn-active:hover { background: transparent; color: var(--p-primary-color); }
</style>
