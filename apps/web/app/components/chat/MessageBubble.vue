<script setup lang="ts">
import type { ChatMessage } from '~/stores/chats'
import VoicePlayer from '~/components/VoicePlayer.vue'
import { formatBytes, formatMessageTime, formatVideoDuration } from '~/utils/format'
import { buildFileUrl } from '~/utils/file-url'

const props = defineProps<{
  msg: ChatMessage
  shape: string                        // bubble corner class — comes from grouping logic
  isMediaOnly: boolean
  /** Locally-known message that this one replies to (for quote rendering). */
  replyTarget?: ChatMessage | null
}>()

defineEmits<{
  (e: 'contextmenu', event: MouseEvent, msg: ChatMessage): void
  (e: 'jumpTo', messageId: string): void
}>()

const config = useRuntimeConfig()
const fileUrl = (fileId: number, remoteFileId?: string) =>
  buildFileUrl(config.public.apiUrl as string, fileId, remoteFileId)

// Telegram-like: round videos autoplay muted; clicking toggles sound + pause
function toggleVideoNote(e: MouseEvent) {
  const wrap = e.currentTarget as HTMLElement
  const video = wrap.querySelector('video') as HTMLVideoElement | null
  if (!video) return
  if (video.paused) {
    video.muted = false
    video.play()
  } else {
    video.pause()
    video.muted = true
  }
}

const isOutgoing = computed(() => props.msg.senderType === 'manager')

/** Short preview of the replied-to message for the quote block. */
function replyPreview(target: ChatMessage): string {
  const c = target.content
  if (!c) return '...'
  switch (c.type) {
    case 'text':      return c.text
    case 'photo':     return '📷 Фото' + (c.caption ? `: ${c.caption}` : '')
    case 'voice':     return '🎤 Голосовое сообщение'
    case 'video':     return '🎥 Видео' + (c.caption ? `: ${c.caption}` : '')
    case 'videoNote': return '⭕ Видеосообщение'
    case 'document':  return '📎 ' + (c.fileName || 'Файл')
    case 'sticker':   return (c.emoji || '🎁') + ' Стикер'
    default:          return 'Сообщение'
  }
}
</script>

<template>
  <div
    class="bubble"
    :class="[
      isOutgoing ? 'bubble-out' : 'bubble-in',
      shape,
      isMediaOnly ? 'bubble-media' : '',
      msg.editedAt ? 'bubble-edited' : '',
    ]"
    @contextmenu="$emit('contextmenu', $event, msg)"
  >
    <!-- Reply quote block — shown above message body when this msg replies to another -->
    <div
      v-if="replyTarget"
      class="reply-quote"
      @click.stop="$emit('jumpTo', replyTarget.id)"
    >
      <div class="reply-quote-author">
        {{ replyTarget.senderType === 'manager' ? 'Вы' : 'Клиент' }}
      </div>
      <div class="reply-quote-text">{{ replyPreview(replyTarget) }}</div>
    </div>

    <template v-if="msg.content?.type === 'text'">
      <div class="bubble-text">
        {{ msg.content.text }}<span class="bubble-meta-inline">
  {{ formatMessageTime(msg.createdAt) }}
</span>
      </div>
    </template>

    <template v-else-if="msg.content?.type === 'photo'">
      <a :href="fileUrl(msg.content.fileId, msg.content.remoteFileId)" target="_blank" rel="noopener" class="media-wrap">
        <img
          :src="fileUrl(msg.content.fileId, msg.content.remoteFileId)"
          :alt="msg.content.caption || 'photo'"
          loading="lazy"
          class="media-img"
        />
        <span class="bubble-meta-overlay">{{ formatMessageTime(msg.createdAt) }}</span>
      </a>
      <div v-if="msg.content.caption" class="bubble-text mt-1.5">
        {{ msg.content.caption }}<span class="bubble-meta-inline">
  {{ formatMessageTime(msg.createdAt) }}
</span>
      </div>
    </template>

    <template v-else-if="msg.content?.type === 'voice'">
      <VoicePlayer
        :src="fileUrl(msg.content.fileId, msg.content.remoteFileId)"
        :duration="msg.content.duration"
        :outgoing="isOutgoing"
        :time="formatMessageTime(msg.createdAt)"
      />
    </template>

    <template v-else-if="msg.content?.type === 'video'">
      <div class="media-wrap">
        <video
          controls
          preload="metadata"
          :src="fileUrl(msg.content.fileId, msg.content.remoteFileId)"
          class="media-img"
        />
        <span class="bubble-meta-overlay">{{ formatMessageTime(msg.createdAt) }}</span>
      </div>
      <div v-if="msg.content.caption" class="bubble-text mt-1.5">
        {{ msg.content.caption }}<span class="bubble-meta-inline">
  {{ formatMessageTime(msg.createdAt) }}
</span>
      </div>
    </template>

    <template v-else-if="msg.content?.type === 'videoNote'">
      <div class="video-note" @click="toggleVideoNote">
        <video
          :src="fileUrl(msg.content.fileId, msg.content.remoteFileId)"
          playsinline
          loop
          muted
          autoplay
          preload="metadata"
          class="video-note-player"
        />
        <span class="video-note-meta">
          <i class="pi pi-volume-up text-[10px]" />
          {{ formatVideoDuration(msg.content.duration) }}
        </span>
        <span class="video-note-time">{{ formatMessageTime(msg.createdAt) }}</span>
      </div>
    </template>

    <template v-else-if="msg.content?.type === 'document'">
      <a
        :href="fileUrl(msg.content.fileId, msg.content.remoteFileId)"
        :download="msg.content.fileName"
        target="_blank"
        class="doc-attachment"
      >
        <span class="doc-icon"><i class="pi pi-file" /></span>
        <span class="flex flex-col min-w-0">
          <span class="text-[13.5px] font-semibold truncate">{{ msg.content.fileName }}</span>
          <span class="text-[11.5px] opacity-70">{{ formatBytes(msg.content.size) }}</span>
        </span>
      </a>
      <div v-if="msg.content.caption" class="bubble-text mt-1.5">
        {{ msg.content.caption }}<span class="bubble-meta-inline">
  {{ formatMessageTime(msg.createdAt) }}
</span>
      </div>
      <span v-if="!msg.content.caption" class="bubble-meta">{{ formatMessageTime(msg.createdAt) }}</span>
    </template>

    <template v-else-if="msg.content?.type === 'sticker'">
      <div class="sticker-display">
        <span class="sticker-emoji">{{ msg.content.emoji || '🎁' }}</span>
        <span class="sticker-time">{{ formatMessageTime(msg.createdAt) }}</span>
      </div>
    </template>

    <template v-else>
      <div class="unsupported">
        <i class="pi pi-info-circle" />
        <span>Сообщение не поддерживается</span>
        <span class="bubble-meta-inline">
  {{ formatMessageTime(msg.createdAt) }}
</span>
      </div>
    </template>
  </div>
</template>

<style>
/* Reply quote block above a bubble body */
.reply-quote {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 10px;
  margin-bottom: 6px;
  border-left: 3px solid currentColor;
  background: rgba(0, 0, 0, 0.04);
  border-radius: 6px;
  cursor: pointer;
  font-size: 12.5px;
  max-width: 100%;
  transition: background 0.12s;
}
.bubble-out .reply-quote { background: rgba(255, 255, 255, 0.18); }
.reply-quote:hover { background: rgba(0, 0, 0, 0.08); }
.bubble-out .reply-quote:hover { background: rgba(255, 255, 255, 0.26); }
.reply-quote-author { font-weight: 600; opacity: 0.85; font-size: 12px; }
.reply-quote-text {
  opacity: 0.78;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 240px;
}

</style>
