<script setup lang="ts">
import type { WaveformTrackBuffer } from '@/stores/hardware-runtime-waveform'

import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { isLikelyClockPort } from '@/lib/project-constraints'

import { getAlignedWaveformTrackSample } from './waveform-helpers'

type WaveformCanvasMetrics = {
  followLatest: boolean
  windowSamples: number
  tailOffsetSamples: number
  cursorASample: number | null
  cursorBSample: number | null
  maxTrackLength: number
}

const props = defineProps<{
  signals: string[]
  tracks: Record<string, WaveformTrackBuffer>
  signalColors: Record<string, string>
  revision: number
}>()

const emit = defineEmits<{
  (e: 'metricsChange', metrics: WaveformCanvasMetrics): void
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const hostRef = ref<HTMLElement | null>(null)
const isPanning = ref(false)

const LANE_HEIGHT = 42
const GRID_STEP_PX = 80
const LEFT_PAD = 12
const RIGHT_PAD = 12
const TOP_PAD = 8
const BOTTOM_PAD = 8
const DEFAULT_SAMPLES_PER_PIXEL = 2
const MIN_SAMPLES_PER_PIXEL = 0.125
const MAX_SAMPLES_PER_PIXEL = 128
const PAN_THRESHOLD_PX = 4
const TRACK_STROKE = '#4f8cff'
const GRID_STROKE = 'rgba(148, 163, 184, 0.18)'
const DIVIDER_STROKE = 'rgba(148, 163, 184, 0.28)'
const CURSOR_A_STROKE = 'rgba(248, 113, 113, 0.95)'
const CURSOR_B_STROKE = 'rgba(251, 191, 36, 0.95)'
const HOVER_STROKE = 'rgba(226, 232, 240, 0.55)'

let resizeObserver: ResizeObserver | null = null
let drawRafId: number | null = null
let samplesPerPixel = DEFAULT_SAMPLES_PER_PIXEL
let tailOffsetSamples = 0
let cursorASample: number | null = null
let cursorBSample: number | null = null
let hoverSample: number | null = null
let pointerSession: {
  pointerId: number
  startX: number
  startY: number
  startTailOffset: number
  startSamplesPerPixel: number
  cursorTarget: 'a' | 'b'
} | null = null

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function getLaneHeight() {
  return props.signals.length * LANE_HEIGHT + TOP_PAD + BOTTOM_PAD
}

function getInnerWidth(hostWidth = hostRef.value?.clientWidth ?? 0) {
  return Math.max(Math.floor(hostWidth) - LEFT_PAD - RIGHT_PAD, 1)
}

function getTrackLength(signal: string) {
  return props.tracks[signal]?.length ?? 0
}

function getMaxTrackLength() {
  return props.signals.reduce((maxLength, signal) => {
    return Math.max(maxLength, getTrackLength(signal))
  }, 0)
}

function getViewport(innerWidth = getInnerWidth()) {
  const maxTrackLength = getMaxTrackLength()
  const visibleSamples = Math.max(innerWidth * samplesPerPixel, 1)
  const maxTailOffset = Math.max(maxTrackLength - visibleSamples, 0)
  const clampedTailOffset = clamp(tailOffsetSamples, 0, maxTailOffset)
  const endSample = Math.max(maxTrackLength - clampedTailOffset, 0)
  const startSample = Math.max(endSample - visibleSamples, 0)

  return {
    innerWidth,
    maxTrackLength,
    visibleSamples,
    startSample,
    endSample,
    tailOffsetSamples: clampedTailOffset,
    samplesPerPixel: visibleSamples / innerWidth,
  }
}

function emitMetrics() {
  const viewport = getViewport()
  emit('metricsChange', {
    followLatest: viewport.tailOffsetSamples <= 0.5,
    windowSamples:
      viewport.maxTrackLength > 0 ? Math.min(viewport.visibleSamples, viewport.maxTrackLength) : 0,
    tailOffsetSamples: viewport.tailOffsetSamples,
    cursorASample,
    cursorBSample,
    maxTrackLength: viewport.maxTrackLength,
  })
}

function scheduleDraw() {
  if (drawRafId !== null) {
    return
  }

  drawRafId = window.requestAnimationFrame(() => {
    drawRafId = null
    draw()
  })
}

function syncViewState() {
  samplesPerPixel = clamp(samplesPerPixel, MIN_SAMPLES_PER_PIXEL, MAX_SAMPLES_PER_PIXEL)

  const viewport = getViewport()
  tailOffsetSamples = viewport.tailOffsetSamples <= 0.5 ? 0 : viewport.tailOffsetSamples

  if (cursorASample !== null && cursorASample >= viewport.maxTrackLength) {
    cursorASample = null
  }
  if (cursorBSample !== null && cursorBSample >= viewport.maxTrackLength) {
    cursorBSample = null
  }
  if (hoverSample !== null && hoverSample >= viewport.maxTrackLength) {
    hoverSample = null
  }

  emitMetrics()
  scheduleDraw()
}

function resetView() {
  samplesPerPixel = DEFAULT_SAMPLES_PER_PIXEL
  tailOffsetSamples = 0
  syncViewState()
}

function followLatest() {
  tailOffsetSamples = 0
  syncViewState()
}

function clearCursors() {
  cursorASample = null
  cursorBSample = null
  syncViewState()
}

function pointerEventToSample(event: PointerEvent) {
  const host = hostRef.value
  if (!host) {
    return null
  }

  const rect = host.getBoundingClientRect()
  const innerWidth = getInnerWidth(rect.width)
  const viewport = getViewport(innerWidth)
  if (viewport.maxTrackLength <= 0) {
    return null
  }

  const localX = clamp(event.clientX - rect.left - LEFT_PAD, 0, innerWidth - 1)
  const sample = Math.floor(viewport.startSample + localX * viewport.samplesPerPixel)
  return clamp(sample, 0, viewport.maxTrackLength - 1)
}

function sampleToCanvasX(sampleIndex: number, viewport: ReturnType<typeof getViewport>) {
  return (sampleIndex - viewport.startSample + 0.5) / viewport.samplesPerPixel
}

function setCursorSample(target: 'a' | 'b', sample: number | null) {
  if (target === 'a') {
    cursorASample = sample
  } else {
    cursorBSample = sample
  }
  syncViewState()
}

function zoomAroundPointer(event: WheelEvent) {
  const host = hostRef.value
  if (!host) {
    return
  }

  const rect = host.getBoundingClientRect()
  const innerWidth = getInnerWidth(rect.width)
  const currentViewport = getViewport(innerWidth)
  if (currentViewport.maxTrackLength <= 0) {
    return
  }

  const anchorX = clamp(event.clientX - rect.left - LEFT_PAD, 0, innerWidth)
  const anchorSample = currentViewport.startSample + anchorX * currentViewport.samplesPerPixel
  const zoomFactor = event.deltaY > 0 ? 1.12 : 0.88
  const nextSamplesPerPixel = clamp(
    samplesPerPixel * zoomFactor,
    MIN_SAMPLES_PER_PIXEL,
    MAX_SAMPLES_PER_PIXEL,
  )
  const nextVisibleSamples = Math.max(innerWidth * nextSamplesPerPixel, 1)
  const maxTailOffset = Math.max(currentViewport.maxTrackLength - nextVisibleSamples, 0)
  const nextStartSample = anchorSample - anchorX * (nextVisibleSamples / innerWidth)
  const clampedStartSample = clamp(
    nextStartSample,
    0,
    Math.max(currentViewport.maxTrackLength - nextVisibleSamples, 0),
  )

  samplesPerPixel = nextSamplesPerPixel
  tailOffsetSamples = clamp(
    currentViewport.maxTrackLength - clampedStartSample - nextVisibleSamples,
    0,
    maxTailOffset,
  )
  syncViewState()
}

function cleanupPointerSession() {
  const host = hostRef.value
  if (host && pointerSession) {
    try {
      host.releasePointerCapture(pointerSession.pointerId)
    } catch {
      // Ignore missing pointer capture during teardown.
    }
  }

  pointerSession = null
  if (isPanning.value) {
    isPanning.value = false
    scheduleDraw()
  }
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 && event.button !== 2) {
    return
  }

  const host = hostRef.value
  if (!host) {
    return
  }

  host.setPointerCapture(event.pointerId)
  pointerSession = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startTailOffset: tailOffsetSamples,
    startSamplesPerPixel: samplesPerPixel,
    cursorTarget: event.button === 2 || event.altKey ? 'b' : 'a',
  }
}

function onPointerMove(event: PointerEvent) {
  if (!isPanning.value) {
    hoverSample = pointerEventToSample(event)
    scheduleDraw()
  }

  if (!pointerSession || pointerSession.pointerId !== event.pointerId) {
    return
  }

  const deltaX = event.clientX - pointerSession.startX
  const deltaY = event.clientY - pointerSession.startY
  if (
    !isPanning.value &&
    pointerSession.cursorTarget === 'a' &&
    (Math.abs(deltaX) >= PAN_THRESHOLD_PX || Math.abs(deltaY) >= PAN_THRESHOLD_PX)
  ) {
    isPanning.value = true
    hoverSample = null
  }

  if (!isPanning.value) {
    return
  }

  tailOffsetSamples = pointerSession.startTailOffset + deltaX * pointerSession.startSamplesPerPixel
  syncViewState()
}

function onPointerUp(event: PointerEvent) {
  if (!pointerSession || pointerSession.pointerId !== event.pointerId) {
    return
  }

  if (!isPanning.value) {
    setCursorSample(pointerSession.cursorTarget, pointerEventToSample(event))
  }

  cleanupPointerSession()
}

function onPointerLeave() {
  if (!isPanning.value) {
    hoverSample = null
    scheduleDraw()
  }
}

function onPointerCancel() {
  hoverSample = null
  cleanupPointerSession()
}

function drawCursorLine(
  context: CanvasRenderingContext2D,
  sampleIndex: number,
  viewport: ReturnType<typeof getViewport>,
  height: number,
  strokeStyle: string,
  dashed: boolean,
) {
  const x = sampleToCanvasX(sampleIndex, viewport)
  if (x < 0 || x > viewport.innerWidth) {
    return
  }

  context.save()
  context.strokeStyle = strokeStyle
  context.lineWidth = 1
  context.setLineDash(dashed ? [4, 4] : [])
  context.beginPath()
  context.moveTo(x, 0)
  context.lineTo(x, height)
  context.stroke()
  context.restore()
}

function drawSignalLane(
  context: CanvasRenderingContext2D,
  signal: string,
  laneIndex: number,
  viewport: ReturnType<typeof getViewport>,
) {
  const track = props.tracks[signal]
  const isClockSignal = isLikelyClockPort(signal)
  const trackStroke = props.signalColors[signal] ?? TRACK_STROKE
  const laneTop = TOP_PAD + laneIndex * LANE_HEIGHT
  const laneBottom = laneTop + LANE_HEIGHT
  const highY = laneTop + 10
  const lowY = laneBottom - 10
  const baselineY = laneTop + LANE_HEIGHT / 2

  context.strokeStyle = DIVIDER_STROKE
  context.beginPath()
  context.moveTo(0, laneBottom)
  context.lineTo(viewport.innerWidth, laneBottom)
  context.stroke()

  context.strokeStyle = GRID_STROKE
  context.beginPath()
  context.moveTo(0, baselineY)
  context.lineTo(viewport.innerWidth, baselineY)
  context.stroke()

  if (!track || track.length === 0 || viewport.maxTrackLength === 0) {
    return
  }

  if (isClockSignal) {
    context.strokeStyle = trackStroke
    context.lineWidth = 1.5
    context.beginPath()

    const visibleCycleStart = Math.max(0, Math.floor(viewport.startSample))
    const visibleCycleEnd = Math.min(viewport.maxTrackLength, Math.ceil(viewport.endSample))
    let hasPath = false

    for (let cycleIndex = visibleCycleStart; cycleIndex < visibleCycleEnd; cycleIndex += 1) {
      const cycleStartX = (cycleIndex - viewport.startSample) / viewport.samplesPerPixel
      const cycleEndX = (cycleIndex + 1 - viewport.startSample) / viewport.samplesPerPixel
      const cycleMidX = cycleStartX + (cycleEndX - cycleStartX) * 0.5

      if (cycleEndX <= 0 || cycleStartX >= viewport.innerWidth) {
        continue
      }

      const clampedStartX = clamp(cycleStartX, 0, viewport.innerWidth)
      const clampedMidX = clamp(cycleMidX, clampedStartX, viewport.innerWidth)
      const clampedEndX = clamp(cycleEndX, clampedMidX, viewport.innerWidth)

      if (!hasPath) {
        context.moveTo(clampedStartX, lowY)
        hasPath = true
      } else {
        context.lineTo(clampedStartX, lowY)
      }

      context.lineTo(clampedStartX, highY)
      context.lineTo(clampedMidX, highY)
      context.lineTo(clampedMidX, lowY)
      context.lineTo(clampedEndX, lowY)
    }

    if (hasPath) {
      context.stroke()
    }

    return
  }

  context.fillStyle = `${trackStroke}22`
  context.strokeStyle = trackStroke
  context.lineWidth = 1.5
  context.beginPath()

  let previousY = lowY
  let hasPath = false

  for (let x = 0; x < viewport.innerWidth; x += 1) {
    const rangeStart = Math.floor(viewport.startSample + x * viewport.samplesPerPixel)
    if (rangeStart >= viewport.maxTrackLength) {
      break
    }

    const rangeEnd = Math.min(
      viewport.maxTrackLength,
      Math.max(
        rangeStart + 1,
        Math.ceil(viewport.startSample + (x + 1) * viewport.samplesPerPixel),
      ),
    )

    const first = getAlignedWaveformTrackSample(signal, track, rangeStart, viewport.maxTrackLength)
    let last = first
    let changed = false

    for (let sampleIndex = rangeStart + 1; sampleIndex < rangeEnd; sampleIndex += 1) {
      const value = getAlignedWaveformTrackSample(
        signal,
        track,
        sampleIndex,
        viewport.maxTrackLength,
      )
      if (value !== last) {
        changed = true
      }
      last = value
    }

    const currentY = last ? highY : lowY
    if (!hasPath) {
      previousY = first ? highY : lowY
      context.moveTo(x, previousY)
      hasPath = true
    } else {
      context.lineTo(x, previousY)
    }

    if (changed || currentY !== previousY) {
      context.lineTo(x, currentY)
    }

    if (last) {
      context.fillRect(x, highY, 1, lowY - highY)
    }

    previousY = currentY
  }

  if (hasPath) {
    context.stroke()
  }
}

function draw() {
  const canvas = canvasRef.value
  const host = hostRef.value
  if (!canvas || !host) {
    return
  }

  const width = Math.max(Math.floor(host.clientWidth), 1)
  const height = Math.max(getLaneHeight(), 1)
  const dpr = window.devicePixelRatio || 1

  if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
  }

  const context = canvas.getContext('2d')
  if (!context) {
    return
  }

  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, width, height)
  context.translate(LEFT_PAD, 0)

  const viewport = getViewport(width - LEFT_PAD - RIGHT_PAD)

  context.strokeStyle = GRID_STROKE
  for (let x = 0; x <= viewport.innerWidth; x += GRID_STEP_PX) {
    context.beginPath()
    context.moveTo(x, 0)
    context.lineTo(x, height)
    context.stroke()
  }

  props.signals.forEach((signal, laneIndex) => {
    drawSignalLane(context, signal, laneIndex, viewport)
  })

  if (hoverSample !== null && hoverSample !== cursorASample && hoverSample !== cursorBSample) {
    drawCursorLine(context, hoverSample, viewport, height, HOVER_STROKE, true)
  }
  if (cursorASample !== null) {
    drawCursorLine(context, cursorASample, viewport, height, CURSOR_A_STROKE, false)
  }
  if (cursorBSample !== null) {
    drawCursorLine(context, cursorBSample, viewport, height, CURSOR_B_STROKE, false)
  }
}

defineExpose({
  clearCursors,
  followLatest,
  resetView,
})

onMounted(() => {
  syncViewState()
  if (typeof ResizeObserver !== 'undefined' && hostRef.value) {
    resizeObserver = new ResizeObserver(() => {
      syncViewState()
    })
    resizeObserver.observe(hostRef.value)
  }
})

onBeforeUnmount(() => {
  cleanupPointerSession()

  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (drawRafId !== null) {
    cancelAnimationFrame(drawRafId)
    drawRafId = null
  }
})

watch(
  () => [props.revision, props.signals.join('\u0000')],
  () => {
    syncViewState()
  },
)
</script>

<template>
  <div
    ref="hostRef"
    class="w-full touch-none select-none"
    :class="isPanning ? 'cursor-grabbing' : 'cursor-crosshair'"
    :style="{ height: `${getLaneHeight()}px` }"
    @contextmenu.prevent
    @dblclick.prevent="resetView"
    @pointercancel="onPointerCancel"
    @pointerdown="onPointerDown"
    @pointerleave="onPointerLeave"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @wheel.prevent="zoomAroundPointer"
  >
    <canvas ref="canvasRef" class="block h-full w-full" />
  </div>
</template>
