const STORAGE_KEY = 'telecrm:voice-speed'
const SPEEDS = [1, 1.5, 2] as const

// Module-level shared state: one speed setting + one active player for the whole app.
const speed = ref<number>(1)
let hydrated = false
let activeStop: (() => void) | null = null

/**
 * Shared voice-message playback state:
 *  - `speed` is remembered (localStorage) and applies to every voice message
 *  - only one voice plays at a time — starting one stops the previous (like Telegram)
 */
export function useVoiceAudio() {
  if (import.meta.client && !hydrated) {
    hydrated = true
    const saved = Number(localStorage.getItem(STORAGE_KEY))
    if ((SPEEDS as readonly number[]).includes(saved)) speed.value = saved
  }

  function cycleSpeed() {
    const i = SPEEDS.indexOf(speed.value as 1 | 1.5 | 2)
    speed.value = SPEEDS[(i + 1) % SPEEDS.length] ?? 1
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, String(speed.value))
  }

  /** Mark this player active, pausing whichever was playing before. */
  function setActive(stop: () => void) {
    if (activeStop && activeStop !== stop) activeStop()
    activeStop = stop
  }
  function clearActive(stop: () => void) {
    if (activeStop === stop) activeStop = null
  }

  return { speed, cycleSpeed, setActive, clearActive }
}
