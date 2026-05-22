<script setup lang="ts">
defineProps<{ open: boolean }>()
defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'accept'): void
  (e: 'cancel'): void
}>()
</script>

<template>
  <Dialog
    :visible="open"
    @update:visible="$emit('update:open', $event)"
    modal
    :showHeader="false"
    :closable="false"
    :draggable="false"
    :pt="{ root: { style: 'border-radius: 18px; overflow: hidden; max-width: 420px;' } }"
    class="take-dialog"
  >
    <div class="p-2">
      <div class="flex flex-col items-center text-center gap-4 px-4 pt-6 pb-2">
        <div class="take-icon">
          <i class="pi pi-bookmark text-2xl" />
        </div>
        <div class="flex flex-col gap-1.5">
          <h3 class="text-[18px] font-bold text-surface-900">Новый чат</h3>
          <p class="text-[14px] text-surface-500 leading-snug max-w-[300px]">
            Взять чат в работу и отправить сообщение?
          </p>
        </div>
      </div>
      <div class="flex gap-2 mt-5 px-1">
        <Button
          label="Отмена"
          severity="secondary"
          outlined
          class="flex-1 !rounded-xl"
          @click="$emit('cancel')"
        />
        <Button
          label="Да, взять"
          class="flex-1 !rounded-xl !font-semibold"
          @click="$emit('accept')"
        />
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.take-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: var(--p-primary-100);
  color: var(--p-primary-600);
  display: flex;
  align-items: center;
  justify-content: center;
}
:deep(.take-dialog .p-dialog-content) {
  padding: 0 1.25rem 1.25rem;
  border-radius: 18px;
}
</style>
