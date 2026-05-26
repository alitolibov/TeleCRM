<script setup lang="ts">
import type { Chat } from '~/stores/chats'
import type { ClientStatus } from '~/components/chat/dialogs/CloseChatDialog.vue'
import { avatarColor, initials } from '~/utils/format'

defineProps<{
  chat: Chat
  info: any | null
}>()

const statusLabels: Record<ClientStatus, string> = {
  thinking: 'Думает',
  consulting: 'Пошёл посоветоваться',
  waiting_price: 'Ждёт снижения цены',
  booked: 'Забронировал',
  bought: 'Купил',
}

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
    <!-- Avatar + name -->
    <div class="flex flex-col items-center text-center pt-7 pb-5 px-5">
      <div class="avatar-circle lg" :class="avatarColor(chat.client.telegramId)">
        {{ initials(chat.client.firstName, chat.client.lastName) }}
      </div>
      <div class="mt-3 text-[17px] font-bold text-surface-900">
        {{ chat.client.firstName }} {{ chat.client.lastName ?? '' }}
      </div>
      <div class="mt-0.5 text-[12.5px] text-surface-400 mono">
        {{ chat.client.username ? `@${chat.client.username}` : `id: ${chat.client.telegramId}` }}
      </div>
    </div>

    <div class="info-divider" />

    <!-- Info block -->
    <div class="px-5 py-4">
      <div class="info-title">Информация</div>
      <dl class="space-y-2.5 mt-3">
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
          {{ statusLabels[(info.currentChatResult?.clientStatus ?? info.latestStatus) as ClientStatus] }}
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
                {{ statusLabels[t.clientStatus as ClientStatus] }}{{ t.flight ? ` · ${t.flight}` : '' }}
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
  </aside>
</template>
