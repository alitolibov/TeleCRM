<script setup lang="ts">
import { buildFileUrl } from '~/utils/file-url'
import { formatBytes } from '~/utils/format'
import { useClientFiles, type ClientFileItem } from '~/composables/useClientFiles'

const props = defineProps<{
  /** Currently open chat id — API resolves to the client's full chat history. */
  chatId: string
}>()

const emit = defineEmits<{
  (e: 'open', payload: { chatId: string; messageId: string }): void
}>()

const config = useRuntimeConfig()
const { items, loading, loadingMore, hasMore, load, loadMore } = useClientFiles()

watch(() => props.chatId, (id) => { if (id) load(id) }, { immediate: true })

function downloadUrl(m: ClientFileItem): string {
  return buildFileUrl(
    config.public.apiUrl as string,
    m.content.fileId,
    m.content.remoteFileId,
    m.content.type,
    m.id,
  )
}

/** Pick an icon class hinting at the document kind. Falls back to a neutral
 *  paperclip so unknown types still render. */
function iconFor(m: ClientFileItem): string {
  const mime = (m.content.mimeType ?? '').toLowerCase()
  const name = (m.content.fileName ?? '').toLowerCase()
  if (mime.startsWith('audio/')) return 'pi pi-volume-up'
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pi pi-file-pdf'
  if (/\b(zip|rar|7z|tar|gz)\b/.test(mime) || /\.(zip|rar|7z|tar|gz)$/.test(name)) return 'pi pi-box'
  if (/\b(xls|xlsx|csv|sheet)\b/.test(mime) || /\.(xlsx?|csv)$/.test(name)) return 'pi pi-file-excel'
  if (/\b(doc|docx|word)\b/.test(mime) || /\.(docx?)$/.test(name)) return 'pi pi-file-word'
  return 'pi pi-file'
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
  }
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' })
}

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
  <div class="files-tab">
    <div v-if="loading && items.length === 0" class="files-empty">
      <i class="pi pi-spin pi-spinner text-xl opacity-50" />
    </div>

    <div v-else-if="items.length === 0" class="files-empty">
      <i class="pi pi-file text-3xl opacity-30" />
      <div class="text-[13px] mt-2">Файлов пока нет</div>
    </div>

    <ul v-else class="files-list">
      <li v-for="m in items" :key="m.id" class="file-row">
        <button
          type="button"
          class="file-main"
          :title="m.content.caption ?? m.content.fileName"
          @click="emit('open', { chatId: m.chatId, messageId: m.id })"
        >
          <span class="file-icon">
            <i :class="iconFor(m)" />
          </span>
          <span class="file-meta">
            <span class="file-name">{{ m.content.fileName || 'файл' }}</span>
            <span class="file-sub">
              {{ formatBytes(m.content.size) }}
              <span class="file-dot">·</span>
              {{ fmtDate(m.createdAt) }}
            </span>
          </span>
        </button>
        <a
          class="file-download"
          :href="downloadUrl(m)"
          :download="m.content.fileName"
          target="_blank"
          rel="noopener"
          title="Скачать"
          @click.stop
        >
          <i class="pi pi-download" />
        </a>
      </li>
    </ul>

    <div ref="sentinel" class="files-sentinel" />

    <div v-if="loadingMore" class="files-foot">
      <i class="pi pi-spin pi-spinner text-sm opacity-50" />
    </div>
  </div>
</template>

<style scoped>
.files-tab {
  padding: 8px 6px 18px;
}

.files-list {
  display: flex;
  flex-direction: column;
}

.file-row {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  transition: background 0.12s;
}
.file-row:hover { background: var(--p-surface-50); }

.file-main {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 6px;
  background: transparent;
  border: none;
  text-align: left;
  cursor: pointer;
}
.file-icon {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  color: var(--p-primary-color);
  font-size: 16px;
}
.file-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  gap: 2px;
}
.file-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--p-surface-900);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}
.file-sub {
  font-size: 11.5px;
  color: var(--p-surface-500);
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.file-dot { opacity: 0.6; }

.file-download {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: var(--p-surface-500);
  font-size: 13px;
  transition: background 0.12s, color 0.12s;
}
.file-download:hover { background: var(--p-surface-200); color: var(--p-surface-800); }

.files-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 0;
  color: var(--p-surface-400);
}
.files-sentinel { height: 1px; }
.files-foot {
  display: flex;
  justify-content: center;
  padding: 12px 0;
}
</style>
