<script setup lang="ts">
import type { ChatMessage } from '~/stores/chats'

defineProps<{
  msg: ChatMessage
  pos: { x: number; y: number }
  canReply: boolean
  canCopy: boolean
  canForward: boolean
  canPin: boolean
  canEdit: boolean
  canDelete: boolean
}>()

defineEmits<{
  (e: 'reply', msg: ChatMessage): void
  (e: 'copy', msg: ChatMessage): void
  (e: 'forward', msg: ChatMessage): void
  (e: 'pin', msg: ChatMessage): void
  (e: 'edit', msg: ChatMessage): void
  (e: 'delete', msg: ChatMessage): void
}>()
</script>

<template>
  <Teleport to="body">
    <div
      class="msg-context-menu"
      :style="{ top: pos.y + 'px', left: pos.x + 'px' }"
      @click.stop
    >
      <button v-if="canReply" class="msg-action-item" @click="$emit('reply', msg)">
        <i class="pi pi-reply" /> Ответить
      </button>
      <button v-if="canCopy" class="msg-action-item" @click="$emit('copy', msg)">
        <i class="pi pi-clone" /> Копировать
      </button>
      <button v-if="canForward" class="msg-action-item" @click="$emit('forward', msg)">
        <i class="pi pi-send" /> Переслать
      </button>
      <button v-if="canPin" class="msg-action-item" @click="$emit('pin', msg)">
        <i class="pi pi-bookmark" /> Закрепить
      </button>
      <div v-if="(canReply || canCopy || canForward || canPin) && (canEdit || canDelete)" class="msg-context-divider" />
      <button v-if="canEdit" class="msg-action-item" @click="$emit('edit', msg)">
        <i class="pi pi-pencil" /> Изменить
      </button>
      <button v-if="canDelete" class="msg-action-item msg-action-danger" @click="$emit('delete', msg)">
        <i class="pi pi-trash" /> Удалить
      </button>
    </div>
  </Teleport>
</template>

<!-- Global (not scoped) — element is teleported to body -->
<style>
.msg-context-menu {
  position: fixed;
  background: var(--p-overlay-modal-background, var(--p-surface-0));
  border: 1px solid var(--p-overlay-modal-border-color, var(--divider));
  border-radius: 10px;
  padding: 4px;
  min-width: 180px;
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.32);
  z-index: 9999;
  animation: msg-menu-in 0.12s ease-out;
}
@keyframes msg-menu-in {
  from { opacity: 0; transform: scale(0.95); }
  to   { opacity: 1; transform: scale(1); }
}
.msg-context-menu .msg-action-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px 12px;
  font-size: 13px;
  color: var(--p-surface-700);
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}
.msg-context-menu .msg-action-item:hover { background: var(--p-surface-100); }
.msg-context-menu .msg-action-danger { color: #ef4444; }
.msg-context-menu .msg-action-danger:hover { background: rgba(239, 68, 68, 0.08); }
.msg-context-divider {
  height: 1px;
  background: var(--p-surface-200);
  margin: 4px 6px;
}
</style>
