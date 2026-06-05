<script setup lang="ts">
import type { ChatMessage, Chat } from '~/stores/chats'
import BaseButton from '~/components/BaseButton.vue'
import { avatarColor, initials } from '~/utils/format'

const props = defineProps<{
  open: boolean
  msg: ChatMessage | null
  /** CRM chats list for the second tab — reuse what the page already has. */
  crmChats: Chat[]
  /** Hide the "Favorites" tab when the menu was opened inside Favorites itself. */
  showFavorites?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  /** Source message + destination — index.vue translates into the right API. */
  (e: 'pick', payload:
    | { kind: 'favorites' }
    | { kind: 'crm'; chat: Chat }
  ): void
}>()

type Tab = 'favorites' | 'crm'
const tab = ref<Tab>('favorites')
const q = ref('')

// Reset every time the dialog opens; default to whatever's visible.
watch(() => props.open, (isOpen) => {
  if (!isOpen) return
  tab.value = props.showFavorites === false ? 'crm' : 'favorites'
  q.value = ''
})

const filteredCrm = computed(() => {
  const needle = q.value.trim().toLowerCase()
  const list = props.crmChats
  if (!needle) return list
  return list.filter((c) => {
    const name = `${c.client.firstName} ${c.client.lastName ?? ''}`.toLowerCase()
    return name.includes(needle) || c.client.username?.toLowerCase().includes(needle)
  })
})

function close() { emit('update:open', false) }

function pickFavorites() {
  emit('pick', { kind: 'favorites' })
}
function pickCrm(c: Chat) {
  emit('pick', { kind: 'crm', chat: c })
}
</script>

<template>
  <Dialog
    :visible="open"
    @update:visible="emit('update:open', $event)"
    modal
    :showHeader="false"
    :draggable="false"
    :pt="{ root: { style: 'border-radius: 18px; overflow: hidden; max-width: 480px; width: 92vw;' } }"
  >
    <div class="fwd">
      <header class="fwd-head">
        <div>
          <h3 class="text-[17px] font-extrabold text-surface-900">Переслать</h3>
          <p class="text-[12px] text-surface-500 mt-0.5">
            Выберите куда отправить сообщение.
          </p>
        </div>
        <button class="fwd-x" type="button" @click="close">
          <i class="pi pi-times" />
        </button>
      </header>

      <div class="fwd-tabs">
        <button
          v-if="showFavorites !== false"
          class="fwd-tab" :class="{ 'fwd-tab-active': tab === 'favorites' }"
          @click="tab = 'favorites'"
        >
          <i class="pi pi-bookmark-fill" /> Избранное
        </button>
        <button
          class="fwd-tab" :class="{ 'fwd-tab-active': tab === 'crm' }"
          @click="tab = 'crm'"
        >
          <i class="pi pi-comments" /> CRM-чат
        </button>
      </div>

      <!-- Favorites: single confirm button — no destination to pick. -->
      <div v-if="tab === 'favorites'" class="fwd-pane fwd-pane-fav">
        <i class="pi pi-bookmark-fill text-3xl text-primary-500" />
        <div class="text-[14px] font-semibold mt-2">Сохранить в Избранное</div>
        <div class="text-[12px] text-surface-500 mt-1 text-center leading-snug">
          Сообщение со ссылкой на оригинал появится в вашей личной папке.
        </div>
        <BaseButton class="mt-4" variant="primary" icon="pi pi-check" @click="pickFavorites">
          Переслать
        </BaseButton>
      </div>

      <!-- CRM chat list: search-as-you-type, instant filter on a local array. -->
      <div v-else class="fwd-pane">
        <div class="fwd-search">
          <i class="pi pi-search" />
          <input v-model="q" placeholder="Имя клиента или @username..." />
        </div>
        <div class="fwd-list">
          <button
            v-for="c in filteredCrm" :key="c.id"
            class="fwd-row" type="button" @click="pickCrm(c)"
          >
            <div class="avatar-circle sm" :class="avatarColor(c.client.telegramId)">
              {{ initials(c.client.firstName, c.client.lastName) }}
            </div>
            <div class="flex-1 min-w-0">
              <div class="fwd-row-title">{{ c.client.firstName }} {{ c.client.lastName ?? '' }}</div>
              <div v-if="c.client.username" class="fwd-row-sub mono">@{{ c.client.username }}</div>
            </div>
          </button>
          <div v-if="filteredCrm.length === 0" class="fwd-empty">Ничего не найдено</div>
        </div>
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.fwd { display: flex; flex-direction: column; min-height: 480px; max-height: 80vh; }
.fwd-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 18px 22px 12px;
  gap: 12px;
}
.fwd-x {
  width: 30px; height: 30px;
  border-radius: 9999px;
  display: flex; align-items: center; justify-content: center;
  color: var(--p-surface-400);
}
.fwd-x:hover { background: var(--p-surface-100); color: var(--p-surface-700); }

.fwd-tabs {
  display: flex;
  gap: 4px;
  padding: 0 16px;
  border-bottom: 1px solid var(--p-surface-200);
}
.fwd-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 12px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--p-surface-500);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.1s, border-color 0.1s;
}
.fwd-tab:hover { color: var(--p-surface-700); }
.fwd-tab-active {
  color: var(--p-primary-color);
  border-bottom-color: var(--p-primary-color);
}

.fwd-pane {
  display: flex;
  flex-direction: column;
  padding: 14px 18px 18px;
  flex: 1;
  min-height: 0;
}
.fwd-pane-fav {
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 28px;
}

.fwd-search {
  position: relative;
  display: flex;
  align-items: center;
  background: var(--p-surface-100);
  border-radius: 9999px;
  padding: 0 14px;
  margin-bottom: 10px;
  flex-shrink: 0;
}
.fwd-search i {
  font-size: 13px;
  color: var(--p-surface-400);
  margin-right: 8px;
}
.fwd-search input {
  flex: 1;
  height: 36px;
  background: none;
  border: none;
  outline: none;
  font-size: 13px;
  color: var(--p-surface-900);
}

.fwd-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.fwd-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  text-align: left;
  cursor: pointer;
  transition: background 0.1s;
}
.fwd-row:hover { background: var(--p-surface-100); }
.fwd-row-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--p-surface-900);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.fwd-row-sub {
  font-size: 11.5px;
  color: var(--p-surface-400);
  margin-top: 2px;
}

.fwd-tg-avatar {
  width: 32px; height: 32px;
  border-radius: 9999px;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  flex-shrink: 0;
}
.fwd-tg-avatar i { font-size: 13px; }

.fwd-empty {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 28px 10px;
  font-size: 12.5px;
  color: var(--p-surface-400);
}
</style>
