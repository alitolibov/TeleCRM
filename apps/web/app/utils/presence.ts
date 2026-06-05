import type { ClientOnlineStatus } from '~/stores/chats'

/**
 * Telegram-style Russian last-seen formatter, intentionally mirroring how
 * the official client labels presence in the chat header:
 *
 *   < 60 s          → "был(а) только что"
 *   < 60 min        → "был(а) X минут(у) назад"  (with correct plural)
 *   same day        → "был(а) сегодня в HH:MM"
 *   yesterday       → "был(а) вчера в HH:MM"
 *   < 7 days        → "был(а) DD месяц в HH:MM"
 *   same year       → "был(а) DD месяц в HH:MM"
 *   older           → "был(а) DD месяц YYYY в HH:MM"
 *
 * The (а) suffix is rendered unconditionally because we don't track gender —
 * Telegram does the same in mixed-locale builds.
 */

const MINUTES_IN_DAY = 1440
const SECONDS_IN_MIN = 60

const MONTHS_GEN = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
]

function pluralRu(n: number, forms: [string, string, string]): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 14) return forms[2]!
  const mod10 = n % 10
  if (mod10 === 1) return forms[0]!
  if (mod10 >= 2 && mod10 <= 4) return forms[1]!
  return forms[2]!
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate()
}

function hhmm(d: Date): string {
  return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
}

/** Render `clients.last_seen_at` like Telegram does in the chat header. */
export function formatLastSeen(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const seen = new Date(iso)
  const diffMs = now.getTime() - seen.getTime()
  const diffSec = Math.floor(diffMs / 1000)

  if (diffSec < SECONDS_IN_MIN) return 'был(а) только что'

  const diffMin = Math.floor(diffSec / SECONDS_IN_MIN)
  if (diffMin < SECONDS_IN_MIN) {
    const word = pluralRu(diffMin, ['минуту', 'минуты', 'минут'])
    return `был(а) ${diffMin} ${word} назад`
  }

  if (isSameDay(seen, now)) return `был(а) сегодня в ${hhmm(seen)}`

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (isSameDay(seen, yesterday)) return `был(а) вчера в ${hhmm(seen)}`

  // Older: switch to date format. Year is shown only when it differs from
  // `now`, matching Telegram's compact "DD месяц [YYYY] в HH:MM".
  const day = seen.getDate()
  const month = MONTHS_GEN[seen.getMonth()]
  const yearSuffix = seen.getFullYear() !== now.getFullYear()
    ? ` ${seen.getFullYear()}`
    : ''
  return `был(а) ${day} ${month}${yearSuffix} в ${hhmm(seen)}`
}

/** Bucket-status (no precise timestamp) → label. */
export function bucketStatusLabel(status: ClientOnlineStatus): string {
  switch (status) {
    case 'online':      return 'в сети'
    case 'recently':    return 'был(а) недавно'
    case 'last_week':   return 'был(а) на этой неделе'
    case 'last_month':  return 'был(а) в этом месяце'
    case 'long_ago':    return 'был(а) давно'
    case 'empty':       return ''             // privacy: hide entirely
    case 'offline':     return ''             // caller should use formatLastSeen
  }
}

/** TDLib chat-action → Russian verb. Mirrors Telegram's exact wording. */
export function chatActionLabel(action: string): string {
  switch (action) {
    case 'typing':   return 'печатает'
    case 'photo':    return 'отправляет фото'
    case 'video':    return 'отправляет видео'
    case 'voice':    return 'записывает голосовое'
    case 'video_note': return 'записывает видео-сообщение'
    case 'document': return 'отправляет файл'
    case 'sticker':  return 'выбирает стикер'
    case 'location': return 'отправляет геопозицию'
    case 'contact':  return 'отправляет контакт'
    case 'game':     return 'играет'
    default:         return ''
  }
}
