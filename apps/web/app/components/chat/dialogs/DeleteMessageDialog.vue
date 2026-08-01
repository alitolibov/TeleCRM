<script setup lang="ts">
import BaseConfirmDialog from '~/components/BaseConfirmDialog.vue'

/** `local` = the entry lives only in the user's own favorites, so nothing
 *  reaches Telegram — the warning copy has to say so. */
defineProps<{ open: boolean; local?: boolean }>()
defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm'): void
}>()
</script>

<template>
  <BaseConfirmDialog
    :open="open"
    icon="pi pi-trash"
    icon-variant="danger"
    title="Удалить сообщение?"
    confirm-label="Удалить"
    confirm-variant="danger"
    @update:open="$emit('update:open', $event)"
    @confirm="$emit('confirm')"
  >
    <template v-if="local">Заметка будет удалена из избранного. Действие необратимо.</template>
    <template v-else>Сообщение будет удалено и у клиента в Telegram.</template>
  </BaseConfirmDialog>
</template>
