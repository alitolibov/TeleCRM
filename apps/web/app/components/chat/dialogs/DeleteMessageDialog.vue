<script setup lang="ts">
import BaseConfirmDialog from '~/components/BaseConfirmDialog.vue'

defineProps<{ open: boolean }>()
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
    Сообщение будет удалено и у клиента в Telegram.
  </BaseConfirmDialog>
</template>
