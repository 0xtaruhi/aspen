<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { useI18n } from '@/lib/i18n'
import { equalStringArrays, normalizeUniqueSignalNames } from '@/lib/signal-names'
import { hardwareStore } from '@/stores/hardware'
import { projectWaveformStore } from '@/stores/project-waveform'

import WaveformCanvas from './WaveformCanvas.vue'
import { orderWaveformSignals } from './waveform-helpers'

type WaveformCanvasHandle = {
  clearCursors: () => void
  followLatest: () => void
  resetView: () => void
}

type WaveformCanvasMetrics = {
  followLatest: boolean
  windowSamples: number
  tailOffsetSamples: number
  cursorASample: number | null
  cursorBSample: number | null
  maxTrackLength: number
}

type WaveformColorLabelKey =
  | 'waveformColorBlue'
  | 'waveformColorEmerald'
  | 'waveformColorAmber'
  | 'waveformColorRose'
  | 'waveformColorViolet'
  | 'waveformColorCyan'

type WaveformColorOption = {
  key: WaveformColorLabelKey
  value: string
}

type WaveformSignalMoveAction = 'top' | 'up' | 'down' | 'bottom'

const props = defineProps<{
  signals: string[]
}>()

const { t } = useI18n()

const waveformCanvasRef = ref<WaveformCanvasHandle | null>(null)
const waveformMetrics = ref<WaveformCanvasMetrics>({
  followLatest: true,
  windowSamples: 0,
  tailOffsetSamples: 0,
  cursorASample: null,
  cursorBSample: null,
  maxTrackLength: 0,
})
const panelBodyRef = ref<HTMLElement | null>(null)
const panelHeight = ref(272)
const signalListWidth = ref(180)

const SIGNAL_LANE_HEIGHT = 42
const SIGNAL_LIST_VERTICAL_PADDING = 16
const SIGNAL_LIST_MIN_WIDTH = 120
const SIGNAL_LIST_DEFAULT_WIDTH = 180
const WAVEFORM_PANEL_MIN_HEIGHT = 180
const WAVEFORM_PANEL_DEFAULT_HEIGHT = 272
const WAVEFORM_DEFAULT_SIGNAL_COLOR = '#4f8cff'
const WAVEFORM_COLOR_OPTIONS: WaveformColorOption[] = [
  { key: 'waveformColorBlue', value: '#4f8cff' },
  { key: 'waveformColorEmerald', value: '#22c55e' },
  { key: 'waveformColorAmber', value: '#f59e0b' },
  { key: 'waveformColorRose', value: '#f43f5e' },
  { key: 'waveformColorViolet', value: '#8b5cf6' },
  { key: 'waveformColorCyan', value: '#06b6d4' },
]

let resizeSession: {
  startHeight: number
  startY: number
} | null = null
let signalListResizeSession: {
  startWidth: number
  startX: number
} | null = null

const waveformTracks = computed(() => hardwareStore.waveformTracks.value)
const waveformRevision = computed(() => hardwareStore.waveformRevision.value)
const waveformSampleRateHz = computed(() => hardwareStore.waveformSampleRateHz.value)
const visibleSignals = computed(() => normalizeUniqueSignalNames(props.signals))
const orderedSignals = computed(() => {
  return orderWaveformSignals(visibleSignals.value, projectWaveformStore.signalOrder.value)
})
const waveformContentHeight = computed(() => {
  return orderedSignals.value.length * SIGNAL_LANE_HEIGHT + SIGNAL_LIST_VERTICAL_PADDING
})
const waveformSignalColors = computed<Record<string, string>>(() => {
  return Object.fromEntries(
    visibleSignals.value.map((signal) => [
      signal,
      projectWaveformStore.signalColorOverrides.value[signal] ?? defaultSignalColor(),
    ]),
  )
})
const windowLabel = computed(() => formatWaveformSpan(waveformMetrics.value.windowSamples))
const cursorALabel = computed(() => formatCursorLabel(waveformMetrics.value.cursorASample))
const cursorBLabel = computed(() => formatCursorLabel(waveformMetrics.value.cursorBSample))
const cursorDeltaLabel = computed(() => {
  const { cursorASample, cursorBSample } = waveformMetrics.value
  if (cursorASample === null || cursorBSample === null) {
    return null
  }

  return formatWaveformSpan(Math.abs(cursorASample - cursorBSample))
})

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getMaxPanelHeight() {
  if (typeof window === 'undefined') {
    return 640
  }

  return Math.max(WAVEFORM_PANEL_DEFAULT_HEIGHT, Math.floor(window.innerHeight * 0.7))
}

function getMaxSignalListWidth() {
  const panelWidth = panelBodyRef.value?.getBoundingClientRect().width ?? 0

  if (panelWidth <= 0) {
    return 420
  }

  return Math.max(SIGNAL_LIST_DEFAULT_WIDTH, Math.min(420, Math.floor(panelWidth - 180)))
}

function defaultSignalColor() {
  return WAVEFORM_DEFAULT_SIGNAL_COLOR
}

function formatWaveformDuration(samples: number) {
  if (waveformSampleRateHz.value <= 0 || samples <= 0) {
    return null
  }

  const seconds = samples / waveformSampleRateHz.value
  if (seconds >= 1) {
    return `${seconds.toFixed(seconds >= 10 ? 1 : 3)} s`
  }
  if (seconds >= 0.001) {
    return `${(seconds * 1_000).toFixed(seconds >= 0.01 ? 1 : 3)} ms`
  }
  if (seconds >= 0.000_001) {
    return `${(seconds * 1_000_000).toFixed(seconds >= 0.000_01 ? 1 : 2)} us`
  }

  return `${(seconds * 1_000_000_000).toFixed(1)} ns`
}

function formatWaveformSpan(samples: number) {
  const roundedSamples = Math.max(0, Math.round(samples))
  const durationLabel = formatWaveformDuration(roundedSamples)
  const sampleLabel = `${roundedSamples} ${t('waveformSamplesSuffix')}`

  return durationLabel ? `${durationLabel} / ${sampleLabel}` : sampleLabel
}

function formatCursorLabel(sample: number | null) {
  if (sample === null) {
    return null
  }

  return `#${sample.toLocaleString()}`
}

function onMetricsChange(nextMetrics: WaveformCanvasMetrics) {
  waveformMetrics.value = nextMetrics
}

function followLatest() {
  waveformCanvasRef.value?.followLatest()
}

function resetView() {
  waveformCanvasRef.value?.resetView()
}

function clearCursors() {
  waveformCanvasRef.value?.clearCursors()
}

function setSignalColor(signal: string, color: string) {
  projectWaveformStore.setSignalColor(signal, color)
}

function resetSignalColor(signal: string) {
  projectWaveformStore.resetSignalColor(signal)
}

function persistVisibleSignalOrder(nextVisibleSignals: readonly string[]) {
  const visibleSignalSet = new Set(visibleSignals.value)
  const fullSignalOrder = normalizeUniqueSignalNames([
    ...projectWaveformStore.signalOrder.value,
    ...visibleSignals.value,
  ])
  const nextVisibleQueue = [...nextVisibleSignals]
  const nextSignalOrder = fullSignalOrder.map((signal) => {
    if (!visibleSignalSet.has(signal)) {
      return signal
    }

    return nextVisibleQueue.shift() ?? signal
  })

  projectWaveformStore.setSignalOrder(nextSignalOrder)
}

function moveSignal(signal: string, action: WaveformSignalMoveAction) {
  const currentOrder = [...orderedSignals.value]
  const currentIndex = currentOrder.indexOf(signal)
  if (currentIndex < 0) {
    return
  }

  const nextOrder = [...currentOrder]
  const [target] = nextOrder.splice(currentIndex, 1)
  if (!target) {
    return
  }

  switch (action) {
    case 'top':
      nextOrder.unshift(target)
      break
    case 'up':
      nextOrder.splice(Math.max(0, currentIndex - 1), 0, target)
      break
    case 'down':
      nextOrder.splice(Math.min(nextOrder.length, currentIndex + 1), 0, target)
      break
    case 'bottom':
      nextOrder.push(target)
      break
  }

  if (equalStringArrays(nextOrder, currentOrder)) {
    return
  }

  persistVisibleSignalOrder(nextOrder)
}

function canMoveSignal(signal: string, action: WaveformSignalMoveAction) {
  const currentIndex = orderedSignals.value.indexOf(signal)
  if (currentIndex < 0) {
    return false
  }

  switch (action) {
    case 'top':
    case 'up':
      return currentIndex > 0
    case 'down':
    case 'bottom':
      return currentIndex < orderedSignals.value.length - 1
  }
}

function startResize(event: PointerEvent) {
  resizeSession = {
    startHeight: panelHeight.value,
    startY: event.clientY,
  }

  window.addEventListener('pointermove', handleResizeMove)
  window.addEventListener('pointerup', stopResize, { once: true })
}

function handleResizeMove(event: PointerEvent) {
  if (!resizeSession) {
    return
  }

  panelHeight.value = clamp(
    resizeSession.startHeight - (event.clientY - resizeSession.startY),
    WAVEFORM_PANEL_MIN_HEIGHT,
    getMaxPanelHeight(),
  )
}

function stopResize() {
  resizeSession = null
  window.removeEventListener('pointermove', handleResizeMove)
}

function startSignalListResize(event: PointerEvent) {
  signalListResizeSession = {
    startWidth: signalListWidth.value,
    startX: event.clientX,
  }

  window.addEventListener('pointermove', handleSignalListResizeMove)
  window.addEventListener('pointerup', stopSignalListResize, { once: true })
}

function handleSignalListResizeMove(event: PointerEvent) {
  if (!signalListResizeSession) {
    return
  }

  signalListWidth.value = clamp(
    signalListResizeSession.startWidth + (event.clientX - signalListResizeSession.startX),
    SIGNAL_LIST_MIN_WIDTH,
    getMaxSignalListWidth(),
  )
}

function stopSignalListResize() {
  signalListResizeSession = null
  window.removeEventListener('pointermove', handleSignalListResizeMove)
}

onBeforeUnmount(() => {
  stopResize()
  stopSignalListResize()
})
</script>

<template>
  <section
    class="shrink-0 border-t border-border/60 bg-[color:var(--content-surface)]/94 px-4 py-2.5 backdrop-blur-xl"
  >
    <div
      class="-mt-1 mb-1.5 flex cursor-row-resize items-center justify-center py-1"
      @pointerdown.prevent="startResize"
    >
      <div class="h-1 w-14 rounded-full bg-border/80" />
    </div>

    <div class="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <p class="text-sm font-medium">{{ t('waveformPanelTitle') }}</p>
        <div class="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <Badge variant="outline">{{ windowLabel }}</Badge>
          <Badge v-if="cursorALabel" variant="outline">
            {{ t('waveformCursorA') }} {{ cursorALabel }}
          </Badge>
          <Badge v-if="cursorBLabel" variant="outline">
            {{ t('waveformCursorB') }} {{ cursorBLabel }}
          </Badge>
          <Badge v-if="cursorDeltaLabel" variant="outline">
            {{ t('waveformCursorDelta') }} {{ cursorDeltaLabel }}
          </Badge>
        </div>
      </div>
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          :variant="waveformMetrics.followLatest ? 'default' : 'outline'"
          :disabled="waveformMetrics.maxTrackLength === 0"
          @click="followLatest"
        >
          {{ t('waveformFollowLatest') }}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          :disabled="waveformMetrics.maxTrackLength === 0"
          @click="resetView"
        >
          {{ t('waveformResetView') }}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          :disabled="
            waveformMetrics.cursorASample === null && waveformMetrics.cursorBSample === null
          "
          @click="clearCursors"
        >
          {{ t('waveformClearCursors') }}
        </Button>
      </div>
    </div>

    <div
      v-if="orderedSignals.length === 0"
      class="flex h-40 items-center justify-center rounded-xl border border-dashed border-border/70 bg-background/40 text-sm text-muted-foreground"
    >
      {{ t('waveformNoSignals') }}
    </div>

    <div
      v-else
      ref="panelBodyRef"
      class="overflow-y-auto rounded-xl border border-border/70 bg-background/45"
      :style="{ height: `${panelHeight}px` }"
    >
      <div
        class="grid min-w-0"
        :style="{ gridTemplateColumns: `${signalListWidth}px 10px minmax(0,1fr)` }"
      >
        <div
          class="border-r border-border/70 px-3 py-2"
          :style="{ minHeight: `${waveformContentHeight}px` }"
        >
          <ContextMenu v-for="signal in orderedSignals" :key="signal">
            <ContextMenuTrigger as-child>
              <div
                class="flex h-[42px] items-center truncate rounded-md px-1 text-xs font-medium text-foreground/85 hover:bg-background/60"
              >
                <span class="truncate font-mono" :title="signal">{{ signal }}</span>
              </div>
            </ContextMenuTrigger>

            <ContextMenuContent class="w-52">
              <ContextMenuLabel>{{ t('waveformColorMenuLabel') }}</ContextMenuLabel>
              <ContextMenuItem @select="resetSignalColor(signal)">
                {{ t('waveformColorAuto') }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                v-for="option in WAVEFORM_COLOR_OPTIONS"
                :key="option.value"
                @select="setSignalColor(signal, option.value)"
              >
                <span
                  class="mr-2 h-2.5 w-2.5 rounded-full"
                  :style="{ backgroundColor: option.value }"
                />
                {{ t(option.key) }}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuLabel>{{ t('waveformArrangeMenuLabel') }}</ContextMenuLabel>
              <ContextMenuItem
                :disabled="!canMoveSignal(signal, 'top')"
                @select="moveSignal(signal, 'top')"
              >
                {{ t('waveformMoveToTop') }}
              </ContextMenuItem>
              <ContextMenuItem
                :disabled="!canMoveSignal(signal, 'up')"
                @select="moveSignal(signal, 'up')"
              >
                {{ t('waveformMoveUp') }}
              </ContextMenuItem>
              <ContextMenuItem
                :disabled="!canMoveSignal(signal, 'down')"
                @select="moveSignal(signal, 'down')"
              >
                {{ t('waveformMoveDown') }}
              </ContextMenuItem>
              <ContextMenuItem
                :disabled="!canMoveSignal(signal, 'bottom')"
                @select="moveSignal(signal, 'bottom')"
              >
                {{ t('waveformMoveToBottom') }}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        </div>

        <div class="relative cursor-col-resize" @pointerdown.prevent="startSignalListResize">
          <div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80" />
        </div>

        <WaveformCanvas
          ref="waveformCanvasRef"
          :signals="orderedSignals"
          :tracks="waveformTracks"
          :signal-colors="waveformSignalColors"
          :revision="waveformRevision"
          @metrics-change="onMetricsChange"
        />
      </div>
    </div>
  </section>
</template>
