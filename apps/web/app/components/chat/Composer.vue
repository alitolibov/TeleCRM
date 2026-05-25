<script setup lang="ts">
import type { ChatMessage } from '~/stores/chats'
import type { Attachment } from '~/composables/useAttachments'

const props = defineProps<{
  modelValue: string                   // v-model for text
  editingMessage: ChatMessage | null
  replyingTo: ChatMessage | null
  uploading: boolean
  attachments: Attachment[]
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
  (e: 'send'): void
  (e: 'cancelEdit'): void
  (e: 'cancelReply'): void
  (e: 'addFiles', files: File[]): void
  (e: 'removeAttachment', id: string): void
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
const hasAttachments = computed(() => props.attachments.length > 0)
// Send is allowed with text, or with attachments (caption optional).
const canSend = computed(() => text.value.trim().length > 0 || hasAttachments.value)

function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const files = input.files ? Array.from(input.files) : []
  input.value = ''
  if (files.length) emit('addFiles', files)
}

/** Paste an image straight from the clipboard into the attachment tray. */
function onPaste(e: ClipboardEvent) {
  if (isEditing.value) return
  const files = Array.from(e.clipboardData?.files ?? [])
  if (files.length) {
    e.preventDefault()
    emit('addFiles', files)
  }
}

function fileExt(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toUpperCase() : 'FILE'
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} КБ`
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`
}

/** Cancelling edit must also clear the input — otherwise the previously-loaded
 *  message text stays in the composer and the user accidentally sends it. */
function onCancelEdit() {
  text.value = ''
  emit('cancelEdit')
}

function onSend() {
  if (!canSend.value) return
  emit('send')
}

function focusTextarea() {
  const ta = document.querySelector('.composer-textarea') as HTMLTextAreaElement | null
  ta?.focus()
}

// Allow parent to focus the textarea (on chat open, edit start, type-to-focus).
defineExpose({
  focus() { nextTick(focusTextarea) },
  focusNow() { focusTextarea() },
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
      <button class="edit-indicator-close" @click="onCancelEdit">
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

    <!-- Attachment preview tray -->
    <div v-if="hasAttachments" class="attach-tray">
      <div
        v-for="att in attachments" :key="att.id"
        class="attach-item"
        :class="{ 'attach-item-file': att.kind === 'file' }"
      >
        <img v-if="att.kind === 'image' && att.url" :src="att.url" class="attach-thumb" alt="" />
        <div v-else-if="att.kind === 'video' && att.url" class="attach-thumb attach-video">
          <video :src="att.url" class="attach-video-el" muted />
          <i class="pi pi-play attach-video-icon" />
        </div>
        <div v-else class="attach-fileinfo">
          <div class="attach-fileicon">{{ fileExt(att.file.name) }}</div>
          <div class="attach-filemeta">
            <div class="attach-filename">{{ att.file.name }}</div>
            <div class="attach-filesize">{{ fileSize(att.file.size) }}</div>
          </div>
        </div>
        <button class="attach-remove" type="button" @click="$emit('removeAttachment', att.id)">
          <i class="pi pi-times" />
        </button>
      </div>

      <!-- Add more -->
      <button class="attach-add" type="button" @click="fileInput?.click()">
        <i class="pi pi-plus" />
      </button>
    </div>

    <!-- Composer -->
    <div class="composer">
      <button
        class="composer-btn"
        :disabled="uploading || isEditing"
        @click="fileInput?.click()"
      >
        <i :class="uploading ? 'pi pi-spin pi-spinner' : 'pi pi-paperclip'" />
      </button>
      <input
        ref="fileInput"
        type="file"
        multiple
        class="hidden"
        accept="image/*,application/pdf,video/*,audio/*,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt"
        @change="onFileChange"
      />
      <div class="composer-input">
        <Textarea
          v-model="text"
          :placeholder="hasAttachments ? 'Добавьте подпись...' : 'Сообщение...'"
          :rows="1"
          autoResize
          unstyled
          class="composer-textarea"
          @paste="onPaste"
          @keydown.enter.exact.prevent="onSend"
        />
      </div>
      <button
        class="composer-send"
        :class="{ 'composer-send-active': canSend }"
        :disabled="!canSend || uploading"
        @click="onSend"
      >
        <i :class="uploading ? 'pi pi-spin pi-spinner' : 'pi pi-send'" />
      </button>
    </div>
  </div>
</template>
