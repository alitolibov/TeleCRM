<script setup lang="ts">
import type { ChatMessage } from '~/stores/chats'

const props = defineProps<{
  modelValue: string                   // v-model for text
  editingMessage: ChatMessage | null
  replyingTo: ChatMessage | null
  uploading: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send'): void
  (e: 'cancelEdit'): void
  (e: 'cancelReply'): void
  (e: 'file', file: File): void
}>()

function replyPreview(target: ChatMessage): string {
  const c = target.content
  if (!c) return '...'
  switch (c.type) {
    case 'text':      return c.text
    case 'photo':     return '📷 Фото' + (c.caption ? `: ${c.caption}` : '')
    case 'voice':     return '🎤 Голосовое сообщение'
    case 'video':     return '🎥 Видео'
    case 'videoNote': return '⭕ Видеосообщение'
    case 'document':  return '📎 ' + (c.fileName || 'Файл')
    case 'sticker':   return (c.emoji || '🎁') + ' Стикер'
    default:          return 'Сообщение'
  }
}

const fileInput = ref<HTMLInputElement>()

const text = computed({
  get: () => props.modelValue,
  set: (v: string) => emit('update:modelValue', v),
})

const isEditing = computed(() => !!props.editingMessage)

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) emit('file', file)
}

// Allow parent to focus the textarea after entering edit mode.
defineExpose({
  focus() {
    nextTick(() => {
      const ta = document.querySelector('.composer-textarea') as HTMLTextAreaElement | null
      ta?.focus()
    })
  },
})
</script>

<template>
  <div>
    <!-- Edit indicator strip -->
    <div v-if="editingMessage" class="edit-indicator">
      <i class="pi pi-pencil" />
      <div class="edit-indicator-body">
        <div class="edit-indicator-title">Редактирование сообщения</div>
        <div class="edit-indicator-preview">
          {{ editingMessage.content?.type === 'text'
            ? editingMessage.content.text
            : (editingMessage.content?.caption || 'медиа') }}
        </div>
      </div>
      <button class="edit-indicator-close" @click="$emit('cancelEdit')">
        <i class="pi pi-times" />
      </button>
    </div>

    <!-- Reply indicator strip -->
    <div v-else-if="replyingTo" class="edit-indicator">
      <i class="pi pi-reply" />
      <div class="edit-indicator-body">
        <div class="edit-indicator-title">
          Ответ {{ replyingTo.senderType === 'manager' ? 'на ваше сообщение' : 'клиенту' }}
        </div>
        <div class="edit-indicator-preview">{{ replyPreview(replyingTo) }}</div>
      </div>
      <button class="edit-indicator-close" @click="$emit('cancelReply')">
        <i class="pi pi-times" />
      </button>
    </div>

    <!-- Composer -->
    <div class="composer">
      <button
        class="composer-btn"
        v-tooltip.top="'Прикрепить файл'"
        :disabled="uploading || isEditing"
        @click="fileInput?.click()"
      >
        <i :class="uploading ? 'pi pi-spin pi-spinner' : 'pi pi-paperclip'" />
      </button>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        accept="image/*,application/pdf,video/*,audio/*,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt"
        @change="onFileChange"
      />
      <div class="composer-input">
        <Textarea
          v-model="text"
          placeholder="Сообщение..."
          :rows="1"
          autoResize
          unstyled
          class="composer-textarea"
          @keydown.enter.exact.prevent="$emit('send')"
        />
      </div>
      <button
        class="composer-send"
        :class="{ 'composer-send-active': text.trim().length > 0 }"
        :disabled="!text.trim()"
        @click="$emit('send')"
      >
        <i class="pi pi-send" />
      </button>
    </div>
  </div>
</template>
