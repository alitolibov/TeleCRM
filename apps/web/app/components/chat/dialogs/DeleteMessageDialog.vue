<script setup lang="ts">
defineProps<{ open: boolean }>()
defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'confirm'): void
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
    :pt="{ root: { style: 'border-radius: 18px; overflow: hidden; max-width: 380px;' } }"
  >
    <div class="p-2">
      <div class="flex flex-col items-center text-center gap-4 px-4 pt-6 pb-2">
        <div class="delete-icon">
          <i class="pi pi-trash text-2xl" />
        </div>
        <div class="flex flex-col gap-1.5">
          <h3 class="text-[18px] font-bold text-surface-900">Удалить сообщение?</h3>
          <p class="text-[14px] text-surface-500 leading-snug max-w-[300px]">
            Сообщение будет удалено и у клиента в Telegram.
          </p>
        </div>
      </div>
      <div class="flex gap-2 px-4 pt-4 pb-4">
        <Button
          label="Отмена"
          severity="secondary"
          outlined
          class="flex-1 !rounded-xl !font-semibold"
          @click="$emit('update:open', false)"
        />
        <Button
          label="Удалить"
          severity="danger"
          class="flex-1 !rounded-xl !font-semibold"
          @click="$emit('confirm')"
        />
      </div>
    </div>
  </Dialog>
</template>

<style scoped>
.delete-icon {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: rgba(220, 38, 38, 0.12);
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
