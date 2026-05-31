<script setup lang="ts">
import type { ChatMessage } from '~/stores/chats'
import type { Attachment } from '~/composables/useAttachments'
import type { QuickReply } from '~/composables/useQuickReplies'

const props = defineProps<{
  modelValue: string                   // v-model for text
  editingMessage: ChatMessage | null
  replyingTo: ChatMessage | null
  uploading: boolean
  attachments: Attachment[]
  /** Hide the paperclip and ignore pasted files — favorites is text-only for now. */
  disableAttach?: boolean
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
  if (isEditing.value || props.disableAttach) return
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

// === Quick replies (spec 19.4): "/" in the input opens a template picker ===
const { items: quickReplies, load: loadQuickReplies } = useQuickReplies()
onMounted(() => loadQuickReplies())

const qrDismissed = ref(false)
const qrIndex = ref(0)

// The "/command" is only active on a single leading-slash line (not while editing).
const qrQuery = computed(() => {
  if (isEditing.value) return null
  const t = props.modelValue
  if (!t.startsWith('/') || t.includes('\n')) return null
  return t.slice(1).toLowerCase().trim()
})
const qrMatches = computed(() =>
  qrQuery.value === null ? [] : quickReplies.value.filter(r => r.name.toLowerCase().includes(qrQuery.value!)),
)
const qrOpen = computed(() => !qrDismissed.value && qrQuery.value !== null && qrMatches.value.length > 0)

watch(qrMatches, () => { qrIndex.value = 0 })
watch(() => props.modelValue, () => { qrDismissed.value = false })

/** Selecting a template inserts its body into the composer for review/edit;
 *  the user presses Send (or Enter) when ready. Cursor goes to the end so
 *  the next keystroke continues the template, not overwrites it. */
function applyQuickReply(r: QuickReply) {
  text.value = r.body
  qrDismissed.value = true
  nextTick(() => {
    const ta = document.querySelector('.composer-textarea') as HTMLTextAreaElement | null
    if (ta) {
      ta.focus()
      const end = ta.value.length
      ta.setSelectionRange(end, end)
    }
  })
}

function onKeydown(e: KeyboardEvent) {
  if (qrOpen.value) {
    if (e.key === 'ArrowDown') { e.preventDefault(); qrIndex.value = (qrIndex.value + 1) % qrMatches.value.length; return }
    if (e.key === 'ArrowUp')   { e.preventDefault(); qrIndex.value = (qrIndex.value - 1 + qrMatches.value.length) % qrMatches.value.length; return }
    if (e.key === 'Enter')     { e.preventDefault(); const r = qrMatches.value[qrIndex.value]; if (r) applyQuickReply(r); return }
    if (e.key === 'Escape')    { e.preventDefault(); qrDismissed.value = true; return }
  }
  // Plain Enter sends; Shift/Ctrl/Cmd/Alt+Enter inserts a newline.
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault()
    onSend()
  }
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
  <div class="composer-wrap">
    <!-- Quick-reply picker (spec 19.4) — opens above the input when typing "/" -->
    <div v-if="qrOpen" class="qr-menu">
      <button
        v-for="(r, i) in qrMatches" :key="r.id"
        type="button"
        class="qr-item"
        :class="{ 'qr-item-active': i === qrIndex }"
        @mousedown.prevent="applyQuickReply(r)"
        @mouseenter="qrIndex = i"
      >
        <span class="qr-name">/{{ r.name }}</span>
        <span class="qr-body">{{ r.body }}</span>
      </button>
    </div>

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
        v-if="!disableAttach"
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
          @keydown="onKeydown"
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

<style scoped>
.composer-wrap { position: relative; }

/* Quick-reply picker floating above the input */
.qr-menu {
  position: absolute;
  bottom: 100%;
  left: 12px;
  right: 12px;
  margin-bottom: 8px;
  max-height: 260px;
  overflow-y: auto;
  padding: 5px;
  border-radius: 12px;
  background: var(--p-surface-0);
  border: 1px solid var(--divider);
  box-shadow: 0 14px 36px rgba(0, 0, 0, 0.22);
  z-index: 20;
}
.qr-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 8px 11px;
  border-radius: 8px;
  text-align: left;
  transition: background 0.1s;
}
.qr-item-active { background: var(--p-surface-100); }
.qr-name { font-size: 13px; font-weight: 700; color: var(--p-primary-color); }
.qr-body {
  font-size: 12.5px;
  color: var(--p-surface-500);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
