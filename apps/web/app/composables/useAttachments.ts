export type AttachmentKind = 'image' | 'video' | 'file'

export interface Attachment {
  id: string
  file: File
  /** Object URL for image/video thumbnails; null for generic files. */
  url: string | null
  kind: AttachmentKind
}

/**
 * Holds files queued in the composer before they're sent (Telegram-style):
 * pick or drop several, preview them, add a caption, then send together.
 * Owns the object-URL lifecycle so previews don't leak memory.
 */
export function useAttachments() {
  const items = ref<Attachment[]>([])

  function kindOf(file: File): AttachmentKind {
    if (file.type.startsWith('image/')) return 'image'
    if (file.type.startsWith('video/')) return 'video'
    return 'file'
  }

  function add(files: File[] | FileList) {
    const incoming = Array.from(files)
    if (incoming.length === 0) return
    const next = incoming.map((file) => {
      const kind = kindOf(file)
      const url = kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : null
      return { id: crypto.randomUUID(), file, url, kind }
    })
    items.value = [...items.value, ...next]
  }

  function remove(id: string) {
    const found = items.value.find((a) => a.id === id)
    if (found?.url) URL.revokeObjectURL(found.url)
    items.value = items.value.filter((a) => a.id !== id)
  }

  function clear() {
    for (const a of items.value) if (a.url) URL.revokeObjectURL(a.url)
    items.value = []
  }

  onUnmounted(clear)

  return { items, add, remove, clear }
}
