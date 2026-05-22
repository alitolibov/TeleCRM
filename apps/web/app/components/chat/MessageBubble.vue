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
const fileUrl = (fileId: number, remoteFileId?: string, contentType?: string) =>
  buildFileUrl(config.public.apiUrl as string, fileId, remoteFileId, contentType)

/** Telegram-style video: no native controls, custom play button overlay.
 *  Clicking the wrapper toggles play/pause; play/pause events flip a class
 *  on the wrapper so we can hide the overlay via CSS. */
function toggleVideoPlayback(e: MouseEvent) {
  const wrap = (e.currentTarget as HTMLElement).closest('.video-msg') as HTMLElement | null
  const video = wrap?.querySelector('video') as HTMLVideoElement | null
  if (!video) return
  if (video.paused) video.play().catch(() => {})
  else video.pause()
}
function onVideoStart(e: Event) {
  ;((e.target as HTMLElement).closest('.video-msg') as HTMLElement | null)?.classList.add('playing')
}
function onVideoStop(e: Event) {
  ;((e.target as HTMLElement).closest('.video-msg') as HTMLElement | null)?.classList.remove('playing')
}
/** Stream playback progress into a CSS variable so the seek bar fills smoothly
 *  without per-message Vue state. */
function onVideoTime(e: Event) {
  const video = e.target as HTMLVideoElement
  const wrap = video.closest('.video-msg') as HTMLElement | null
  if (!wrap || !video.duration) return
  const pct = (video.currentTime / video.duration) * 100
  wrap.style.setProperty('--video-progress', `${pct}%`)
}
function onVideoSeek(e: MouseEvent) {
  const bar = e.currentTarget as HTMLElement
  const video = bar.closest('.video-msg')?.querySelector('video') as HTMLVideoElement | null
  if (!video || !video.duration) return
  const rect = bar.getBoundingClientRect()
  const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
  video.currentTime = video.duration * ratio
}

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
      <a :href="fileUrl(msg.content.fileId, msg.content.remoteFileId, msg.content.type)" target="_blank" rel="noopener" class="media-wrap">
        <img
          :src="fileUrl(msg.content.fileId, msg.content.remoteFileId, msg.content.type)"
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
        :src="fileUrl(msg.content.fileId, msg.content.remoteFileId, msg.content.type)"
        :duration="msg.content.duration"
        :outgoing="isOutgoing"
        :time="formatMessageTime(msg.createdAt)"
      />
    </template>

    <template v-else-if="msg.content?.type === 'video'">
      <div class="video-msg" @click="toggleVideoPlayback">
        <video
          preload="metadata"
          playsinline
          :src="fileUrl(msg.content.fileId, msg.content.remoteFileId, msg.content.type)"
          class="video-msg-player"
          @play="onVideoStart"
          @pause="onVideoStop"
          @ended="onVideoStop"
          @timeupdate="onVideoTime"
        />
        <button class="video-msg-play" type="button" @click.stop="toggleVideoPlayback">
          <i class="pi pi-play" />
        </button>
        <span class="video-msg-duration">{{ formatVideoDuration(msg.content.duration) }}</span>
        <span class="bubble-meta-overlay">{{ formatMessageTime(msg.createdAt) }}</span>
        <div class="video-msg-bar" @click.stop="onVideoSeek" @mousedown.stop>
          <div class="video-msg-bar-fill" />
        </div>
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
          :src="fileUrl(msg.content.fileId, msg.content.remoteFileId, msg.content.type)"
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
        :href="fileUrl(msg.content.fileId, msg.content.remoteFileId, msg.content.type)"
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

/* Telegram-style video player */
.video-msg {
  position: relative;
  display: block;
  cursor: pointer;
  border-radius: 12px;
  overflow: hidden;
  line-height: 0;
}
.video-msg-player {
  display: block;
  width: 100%;
  max-width: 100%;
  max-height: 360px;
  height: auto;
  background: #000;
}
.video-msg-play {
  position: absolute;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%);
  width: 52px;
  height: 52px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 18px;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  transition: opacity 0.15s, transform 0.12s, background 0.15s;
  z-index: 2;
}
/* nudge play triangle visually to center */
.video-msg-play > i { margin-left: 3px; }
.video-msg-play:hover { background: rgba(0, 0, 0, 0.7); transform: translate(-50%, -50%) scale(1.05); }
.video-msg.playing .video-msg-play { opacity: 0; pointer-events: none; }

.video-msg-duration {
  position: absolute;
  top: 8px;
  left: 8px;
  padding: 2px 8px;
  border-radius: 9999px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.5;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  z-index: 2;
}
.video-msg.playing .video-msg-duration { opacity: 0; transition: opacity 0.2s; }

/* Seek bar at the bottom — thin by default, taller on hover for easier clicking */
.video-msg-bar {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  height: 4px;
  background: rgba(255, 255, 255, 0.18);
  cursor: pointer;
  z-index: 3;
  transition: height 0.12s;
}
.video-msg-bar:hover { height: 7px; }
.video-msg-bar-fill {
  height: 100%;
  width: var(--video-progress, 0%);
  background: var(--p-primary-color);
  transition: width 0.08s linear;
}

</style>
