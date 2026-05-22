<script setup lang="ts">
import BaseConfirmDialog from '~/components/BaseConfirmDialog.vue'

defineProps<{ open: boolean }>()
defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'accept'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <BaseConfirmDialog
    :open="open"
    icon="pi pi-bookmark"
    icon-variant="primary"
    title="Новый чат"
    confirm-label="Да, взять"
    @update:open="(v: boolean) => !v && $emit('cancel')"
    @confirm="$emit('accept')"
  >
    Взять чат в работу и отправить сообщение?
  </BaseConfirmDialog>
</template>
