const STORAGE_KEY = 'telecrm:sound-enabled'

// Module-level singletons so every caller shares one AudioContext + setting.
let ctx: AudioContext | null = null
const soundEnabled = ref(true)
let hydrated = false
let armed = false

function getContext(): AudioContext | null {
  if (!import.meta.client) return null
  ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)()
  return ctx
}

/** Shared with VoicePlayer so HTMLAudioElement output is routed through
 *  the same AudioContext as the notification chime. Without this, some
 *  Chromium builds suppress the `<audio>` output entirely when an
 *  AudioContext exists in the page — element plays (currentTime advances)
 *  but no sound reaches the speakers. */
export function getSharedAudioContext(): AudioContext | null {
  return getContext()
}

/**
 * Browsers block audio until the user interacts with the page, so an
 * AudioContext created from a WebSocket handler starts suspended. We resume it
 * on the first real user gesture, after which programmatic chimes play.
 */
function armUnlock() {
  if (!import.meta.client || armed) return
  armed = true
  const unlock = () => { getContext()?.resume().catch(() => {}) }
  window.addEventListener('pointerdown', unlock, { once: true })
  window.addEventListener('keydown', unlock, { once: true })
}

/**
 * Plays a short notification chime via the Web Audio API — no asset file needed.
 * Synthesises a gentle two-note "ding" so we don't ship a binary sound file.
 * Respects a localStorage on/off preference (default on).
 */
export function useNotificationSound() {
  if (import.meta.client && !hydrated) {
    hydrated = true
    soundEnabled.value = localStorage.getItem(STORAGE_KEY) !== '0'
  }
  armUnlock()

  function setEnabled(v: boolean) {
    soundEnabled.value = v
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
  }

  function play() {
    if (!import.meta.client || !soundEnabled.value) return
    const audio = getContext()
    if (!audio) return

    // Schedule the two notes. `currentTime` is read AFTER resume completes,
    // otherwise on a just-resumed context the start time lands in the past.
    const fire = () => {
      try {
        const now = audio.currentTime
        const notes = [{ f: 880, t: 0 }, { f: 1175, t: 0.11 }] // A5 → D6
        for (const n of notes) {
          const osc = audio.createOscillator()
          const gain = audio.createGain()
          osc.type = 'sine'
          osc.frequency.value = n.f
          gain.gain.setValueAtTime(0.0001, now + n.t)
          gain.gain.exponentialRampToValueAtTime(0.18, now + n.t + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + 0.2)
          osc.connect(gain)
          gain.connect(audio.destination)
          osc.start(now + n.t)
          osc.stop(now + n.t + 0.22)
        }
      } catch { /* ignore */ }
    }

    // resume() resolves only when triggered within (or after) a user gesture;
    // if it rejects (never unlocked), we simply stay silent.
    if (audio.state === 'suspended') audio.resume().then(fire).catch(() => {})
    else fire()
  }

  return { soundEnabled, setEnabled, play }
}
