<script setup lang="ts">
import { buildFileUrl } from '~/utils/file-url'
import { formatVideoDuration } from '~/utils/format'
import { useClientMedia, type ClientMediaItem } from '~/composables/useClientMedia'

const props = defineProps<{
  /** Currently open chat id — the API resolves to the client's full chat history. */
  chatId: string
}>()

const emit = defineEmits<{
  (e: 'open', payload: { chatId: string; messageId: string }): void
}>()

const config = useRuntimeConfig()
const { items, loading, loadingMore, hasMore, load, loadMore } = useClientMedia()

watch(() => props.chatId, (id) => { if (id) load(id) }, { immediate: true })

function thumbUrl(m: ClientMediaItem): string {
  return buildFileUrl(
    config.public.apiUrl as string,
    m.content.fileId,
    m.content.remoteFileId,
    m.content.type,
    m.id,
  )
}

// IntersectionObserver pages-in more media as the sentinel scrolls into view —
// the parent `.client-panel` owns scrolling, we just watch the sentinel.
const sentinel = ref<HTMLElement>()
let observer: IntersectionObserver | null = null

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries[0]?.isIntersecting && hasMore.value && !loadingMore.value) {
      loadMore(props.chatId)
    }
  }, { rootMargin: '120px' })
  if (sentinel.value) observer.observe(sentinel.value)
})

onUnmounted(() => observer?.disconnect())

watch(sentinel, (el, prev) => {
  if (prev) observer?.unobserve(prev)
  if (el) observer?.observe(el)
})
</script>

<template>
  <div class="media-tab">
    <div v-if="loading && items.length === 0" class="media-empty">
      <i class="pi pi-spin pi-spinner text-xl opacity-50" />
    </div>

    <div v-else-if="items.length === 0" class="media-empty">
      <i class="pi pi-image text-3xl opacity-30" />
      <div class="text-[13px] mt-2">Медиа пока нет</div>
    </div>

    <div v-else class="media-grid">
      <button
        v-for="m in items"
        :key="m.id"
        type="button"
        class="media-cell"
        :title="m.content.caption ?? ''"
        @click="emit('open', { chatId: m.chatId, messageId: m.id })"
      >
        <img
          v-if="m.contentType === 'photo'"
          :src="thumbUrl(m)"
          loading="lazy"
          decoding="async"
          alt=""
        />
        <template v-else>
          <video
            :src="thumbUrl(m)"
            preload="metadata"
            muted
            playsinline
          />
          <span class="media-cell-overlay">
            <i class="pi pi-play" />
          </span>
          <span v-if="m.content.duration" class="media-cell-duration">
            {{ formatVideoDuration(m.content.duration) }}
          </span>
        </template>
      </button>
    </div>

    <div ref="sentinel" class="media-sentinel" />

    <div v-if="loadingMore" class="media-foot">
      <i class="pi pi-spin pi-spinner text-sm opacity-50" />
    </div>
  </div>
</template>

<style scoped>
.media-tab {
  padding: 12px 14px 18px;
}

.media-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
}

.media-cell {
  position: relative;
  display: block;
  aspect-ratio: 1 / 1;
  overflow: hidden;
  border-radius: 8px;
  background: var(--p-surface-100);
  transition: transform 0.12s, opacity 0.12s;
  cursor: pointer;
}
.media-cell:hover {
  transform: scale(1.02);
}
.media-cell:active {
  opacity: 0.85;
}
.media-cell > img,
.media-cell > video {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.media-cell-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.18);
  font-size: 22px;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
.media-cell-duration {
  position: absolute;
  right: 6px;
  bottom: 5px;
  padding: 1px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.55);
  color: #fff;
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

.media-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 0;
  color: var(--p-surface-400);
}

.media-sentinel {
  height: 1px;
}

.media-foot {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}
</style>
