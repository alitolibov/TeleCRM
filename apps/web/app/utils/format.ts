/** Bytes → human-readable size (1.5 KB, 2.3 MB, …) */
export function formatBytes(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/** "Сегодня" / "Вчера" / "5 марта" / "5 марта 2025" — day separator label. */
export function formatDay(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1)
  if (d.toDateString() === now.toDateString()) return 'Сегодня'
  if (d.toDateString() === yesterday.toDateString()) return 'Вчера'
  return d.toLocaleDateString('ru', {
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  })
}

/** Chat-list timestamp: today → HH:MM, week → "вт", older → "5 мар". */
export function formatTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
  const oneWeek = 7 * 24 * 60 * 60 * 1000
  if (now.getTime() - d.getTime() < oneWeek) {
    return d.toLocaleDateString('ru', { weekday: 'short' })
  }
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}

/** Message-bubble timestamp — always HH:MM (day comes from the separator above). */
export function formatMessageTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
}

/** Seconds → M:SS (for voice/video duration display). */
export function formatVideoDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const AVATAR_COLORS = ['orange', 'blue', 'green', 'purple', 'pink', 'teal'] as const

/** Deterministic avatar color from numeric id. */
export function avatarColor(id: number): string {
  return AVATAR_COLORS[id % AVATAR_COLORS.length]!
}

/** "Имя Фамилия" → "ИФ" (max 2 letters, uppercase). */
export function initials(first: string, last?: string | null): string {
  return ((first?.[0] ?? '') + (last?.[0] ?? '')).toUpperCase() || '?'
}
