const STORAGE_KEY = 'telecrm:sound-enabled'

const soundEnabled = ref(true)
let hydrated = false
let chimeBlobUrl: string | null = null

/**
 * Build a tiny two-tone "ding" as raw PCM, wrap in a WAV container, hand
 * back a blob URL. Done once, lazily — the resulting URL stays valid for
 * the page lifetime.
 *
 * We deliberately AVOID `AudioContext` here. Some Chromium builds tie the
 * page's audio session to a live AudioContext: once one exists, every
 * other `<audio>` element on the page plays SILENTLY (currentTime
 * advances, no error fires, no sound reaches the speakers). That bit our
 * voice messages — file played fine in a fresh tab but went silent in
 * the SPA the moment notifications armed the AudioContext. Synthesising
 * the chime into a WAV blob and playing it through a regular `<audio>`
 * element keeps the whole page off the Web Audio path entirely.
 */
function makeChimeBlobUrl(): string | null {
  if (!import.meta.client) return null
  if (chimeBlobUrl) return chimeBlobUrl

  const sampleRate = 22050      // good enough for a short chime, half the bytes
  const duration = 0.4
  const sampleCount = Math.floor(sampleRate * duration)
  const dataBytes = sampleCount * 2     // 16-bit mono
  const buffer = new ArrayBuffer(44 + dataBytes)
  const view = new DataView(buffer)

  // RIFF header
  let p = 0
  const writeStr = (s: string) => { for (const c of s) view.setUint8(p++, c.charCodeAt(0)) }
  writeStr('RIFF')
  view.setUint32(p, 36 + dataBytes, true); p += 4
  writeStr('WAVE')
  writeStr('fmt ')
  view.setUint32(p, 16, true); p += 4              // fmt chunk size
  view.setUint16(p, 1, true);  p += 2              // PCM
  view.setUint16(p, 1, true);  p += 2              // mono
  view.setUint32(p, sampleRate, true); p += 4
  view.setUint32(p, sampleRate * 2, true); p += 4  // byte rate
  view.setUint16(p, 2, true);  p += 2              // block align
  view.setUint16(p, 16, true); p += 2              // bits per sample
  writeStr('data')
  view.setUint32(p, dataBytes, true); p += 4

  // Synth: A5 (880 Hz) then D6 (1175 Hz), short and quiet — Telegram-ish ping.
  // Each note's amplitude envelope: sharp attack, exponential decay so it
  // doesn't sound like a hard click.
  const notes = [
    { f: 880,  start: 0.00, decay: 22 },
    { f: 1175, start: 0.11, decay: 22 },
  ]
  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleRate
    let sample = 0
    for (const n of notes) {
      if (t < n.start) continue
      const dt = t - n.start
      sample += Math.sin(2 * Math.PI * n.f * dt) * Math.exp(-dt * n.decay)
    }
    // Master gain — 0.22 keeps it noticeable but not jarring.
    const s = Math.max(-1, Math.min(1, sample * 0.22))
    view.setInt16(44 + i * 2, Math.round(s * 32767), true)
  }

  const blob = new Blob([buffer], { type: 'audio/wav' })
  chimeBlobUrl = URL.createObjectURL(blob)
  return chimeBlobUrl
}

export function useNotificationSound() {
  if (import.meta.client && !hydrated) {
    hydrated = true
    soundEnabled.value = localStorage.getItem(STORAGE_KEY) !== '0'
  }

  function setEnabled(v: boolean) {
    soundEnabled.value = v
    if (import.meta.client) localStorage.setItem(STORAGE_KEY, v ? '1' : '0')
  }

  function play() {
    if (!import.meta.client || !soundEnabled.value) return
    const url = makeChimeBlobUrl()
    if (!url) return
    const a = new Audio(url)
    a.volume = 0.55
    // play() may be rejected if no user gesture has unlocked autoplay yet —
    // that's fine, the next click/keypress will let the chime through.
    a.play().catch(() => {})
  }

  return { soundEnabled, setEnabled, play }
}
