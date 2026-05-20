<template>
  <div class="voice-player" :class="outgoing ? 'voice-out' : 'voice-in'">
    <button class="voice-play" type="button" @click="toggle">
      <i :class="playing ? 'pi pi-pause' : 'pi pi-play'" />
    </button>
    <div class="voice-body">
      <div class="voice-track" @click="seek">
        <div class="voice-track-fill" :style="{ width: `${progress * 100}%` }" />
      </div>
      <div class="voice-info">
        <span>{{ formatTime(currentTime) }} / {{ formatTime(duration || audioDuration) }}</span>
        <span v-if="time" class="voice-time">{{ time }}</span>
      </div>
    </div>
    <audio
      ref="audio"
      :src="src"
      preload="metadata"
      @loadedmetadata="onLoaded"
      @timeupdate="onTimeUpdate"
      @ended="playing = false"
    />
  </div>
</template>

<script setup lang="ts">
const props = defineProps<{
  src: string
  duration?: number
  outgoing?: boolean
  time?: string
}>()

const audio = ref<HTMLAudioElement>()
const playing = ref(false)
const currentTime = ref(0)
const audioDuration = ref(0)

const progress = computed(() => {
  const d = props.duration || audioDuration.value
  if (!d) return 0
  return Math.min(currentTime.value / d, 1)
})

function toggle() {
  const el = audio.value
  if (!el) return
  if (playing.value) {
    el.pause()
    playing.value = false
  } else {
    void el.play().then(() => { playing.value = true }).catch(() => {})
  }
}

function onLoaded() {
  if (audio.value) audioDuration.value = audio.value.duration || 0
}
function onTimeUpdate() {
  if (audio.value) currentTime.value = audio.value.currentTime
}
function seek(e: MouseEvent) {
  const el = audio.value
  if (!el) return
  const target = e.currentTarget as HTMLElement
  const rect = target.getBoundingClientRect()
  const ratio = (e.clientX - rect.left) / rect.width
  const d = props.duration || audioDuration.value
  if (d) el.currentTime = Math.max(0, Math.min(d, d * ratio))
}

function formatTime(s: number): string {
  if (!s || !isFinite(s)) return '0:00'
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}
</script>

<style scoped>
.voice-player {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 220px;
  max-width: 280px;
}
.voice-play {
  width: 36px;
  height: 36px;
  border-radius: 9999px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: filter 0.1s;
}
.voice-play:hover { filter: brightness(1.1); }
.voice-play i { font-size: 13px; }
.voice-in .voice-play {
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  color: var(--p-primary-color);
}
.voice-out .voice-play {
  background: rgba(255, 255, 255, 0.22);
  color: #fff;
}
.voice-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.voice-track {
  height: 4px;
  border-radius: 9999px;
  cursor: pointer;
  position: relative;
}
.voice-in .voice-track { background: color-mix(in srgb, var(--p-surface-900) 10%, transparent); }
.voice-out .voice-track { background: rgba(255, 255, 255, 0.28); }
.voice-track-fill {
  height: 100%;
  border-radius: 9999px;
  transition: width 0.1s linear;
}
.voice-in .voice-track-fill { background: var(--p-primary-color); }
.voice-out .voice-track-fill { background: #fff; }
.voice-info {
  display: flex;
  justify-content: space-between;
  font-size: 10.5px;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.voice-time { opacity: 0.85; }
</style>
