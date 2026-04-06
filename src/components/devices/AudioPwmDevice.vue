<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue'
import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  frequencyHz: number
  dutyRatio: number
  sampleRateHz: number
  edgeCount: number
  isOn: boolean
}>()

let sharedAudioContext: AudioContext | null = null
let resumeHooksInstalled = false

function getSharedAudioContext() {
  if (typeof window === 'undefined' || typeof AudioContext === 'undefined') {
    return null
  }

  if (!sharedAudioContext) {
    sharedAudioContext = new AudioContext({ latencyHint: 'interactive' })
  }

  if (!resumeHooksInstalled) {
    const resume = () => {
      void sharedAudioContext?.resume().catch(() => undefined)
    }
    window.addEventListener('pointerdown', resume, { passive: true })
    window.addEventListener('keydown', resume)
    resumeHooksInstalled = true
  }

  return sharedAudioContext
}

const oscillator = shallowRef<OscillatorNode | null>(null)
const gainNode = shallowRef<GainNode | null>(null)
const { t } = useI18n()

const audible = computed(() => {
  return (
    props.sampleRateHz > 0 &&
    props.frequencyHz >= 20 &&
    props.frequencyHz <= 5000 &&
    props.edgeCount > 0
  )
})

const displayFrequency = computed(() => {
  if (!audible.value) {
    return '--'
  }

  return props.frequencyHz >= 1000
    ? `${(props.frequencyHz / 1000).toFixed(2).replace(/\.?0+$/, '')} kHz`
    : `${props.frequencyHz.toFixed(1).replace(/\.0$/, '')} Hz`
})

const displayDuty = computed(() => `${(props.dutyRatio * 100).toFixed(1).replace(/\.0$/, '')}%`)

const bars = computed(() => {
  const clamped = Math.max(0, Math.min(1, props.dutyRatio))
  const lit = Math.max(1, Math.round(clamped * 10))
  return Array.from({ length: 10 }, (_, index) => index < lit && audible.value)
})

function ensureAudioNodes() {
  const context = getSharedAudioContext()
  if (!context || oscillator.value || gainNode.value) {
    return
  }

  const osc = context.createOscillator()
  osc.type = 'square'

  const gain = context.createGain()
  gain.gain.value = 0

  osc.connect(gain)
  gain.connect(context.destination)
  osc.start()

  oscillator.value = osc
  gainNode.value = gain
}

function updateAudio() {
  ensureAudioNodes()
  const context = getSharedAudioContext()
  if (!context || !oscillator.value || !gainNode.value) {
    return
  }

  const frequency = Math.max(20, Math.min(5000, props.frequencyHz || 0))
  oscillator.value.frequency.setTargetAtTime(frequency, context.currentTime, 0.01)
  gainNode.value.gain.setTargetAtTime(audible.value ? 0.045 : 0, context.currentTime, 0.02)
}

watch(
  () => [props.frequencyHz, props.dutyRatio, props.sampleRateHz, props.edgeCount],
  () => updateAudio(),
  { immediate: true },
)

onMounted(() => {
  updateAudio()
})

onBeforeUnmount(() => {
  gainNode.value?.disconnect()
  oscillator.value?.disconnect()
  oscillator.value?.stop()
  gainNode.value = null
  oscillator.value = null
})
</script>

<template>
  <div class="flex h-full w-full flex-col gap-3 p-3">
    <div class="rounded-md border border-border/70 bg-muted/25 px-3 py-2">
      <div class="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {{ t('audioPwm') }}
      </div>
      <div class="mt-2 flex items-end justify-between gap-3">
        <div class="text-lg font-semibold tabular-nums text-foreground">
          {{ displayFrequency }}
        </div>
        <div class="text-xs font-mono text-muted-foreground">
          {{ props.isOn ? t('high') : t('low') }}
        </div>
      </div>
      <div class="mt-1 text-xs font-mono text-muted-foreground">DUTY {{ displayDuty }}</div>
    </div>

    <div class="grid grid-cols-10 gap-1 rounded-md border border-border/70 bg-background/70 p-2">
      <div
        v-for="(lit, index) in bars"
        :key="index"
        class="h-8 rounded-sm border border-zinc-800 transition-colors"
        :class="lit ? 'bg-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.35)]' : 'bg-zinc-900'"
      />
    </div>
  </div>
</template>
