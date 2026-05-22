<script setup lang="ts">
import BaseConfirmDialog from '~/components/BaseConfirmDialog.vue'

const props = defineProps<{
  open: boolean
  /** Empty = no current owner (claim flow); set = transfer flow. */
  ownerName: string
  actionLabel: string
}>()

defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm'): void
}>()

const isClaim = computed(() => !props.ownerName)
</script>

<template>
  <BaseConfirmDialog
    :open="open"
    icon="pi pi-shield"
    icon-variant="warning"
    :title="isClaim ? 'Стать владельцем чата?' : 'Перехватить чат?'"
    :confirm-label="isClaim ? 'Стать владельцем' : 'Перехватить'"
    @update:open="$emit('update:open', $event)"
    @confirm="$emit('confirm')"
  >
    <template v-if="isClaim">
      У этого чата нет владельца. Действие «{{ actionLabel }}» сделает вас владельцем.
    </template>
    <template v-else>
      Чат назначен на <strong>{{ ownerName }}</strong>.
      Действие «{{ actionLabel }}» переведёт чат на вас.
    </template>
    <template #hint>Действие будет зафиксировано в логах.</template>
  </BaseConfirmDialog>
</template>
