<script setup lang="ts">
import { computed, onMounted, ref, watch, type Component } from 'vue'
import BaseDevice from '../devices/BaseDevice.vue'
import WireLayer from './WireLayer.vue'
import LedDevice from '../devices/LedDevice.vue'
import SwitchDevice from '../devices/SwitchDevice.vue'
import ButtonDevice from '../devices/ButtonDevice.vue'
import GenericPanelDevice from '../devices/GenericPanelDevice.vue'
import SegmentDisplayDevice from '../devices/SegmentDisplayDevice.vue'
import LedMatrixDevice from '../devices/LedMatrixDevice.vue'
import { hardwareStore } from '@/stores/hardware'
import type { CanvasDeviceSnapshot, CanvasDeviceType } from '@/lib/hardware-client'
import { consumePaletteDrop, paletteDragStore } from '@/stores/palette-drag'
import {
  canvasDeviceEmitsToggle,
  createCanvasDeviceSnapshot,
  getCanvasDeviceBoundSignal,
  getCanvasDeviceBoundSignalCount,
  deviceReceivesSignal,
  getCanvasMatrixDimensions,
  getCanvasSegmentDisplayConfig,
  getCanvasDeviceRendererProps,
  isCanvasMatrixDevice,
  isCanvasSegmentDisplayDevice,
} from '@/lib/canvas-devices'

const props = defineProps<{
  selectedDeviceId?: string | null
  blockedTopInset?: number
}>()

const emit = defineEmits<{
  (e: 'update:selectedDeviceId', value: string | null): void
  (e: 'open-settings', value: string): void
}>()

const canvasRef = ref<HTMLElement | null>(null)

// State
const scale = ref(1)
const offset = ref({ x: 0, y: 0 })
const isDraggingCanvas = ref(false)
const lastMousePos = ref({ x: 0, y: 0 })
const transientDevicePositions = ref<Record<string, { x: number; y: number }>>({})
const animatingDeviceIds = ref<Record<string, boolean>>({})

const devices = computed(() => hardwareStore.state.value.canvas_devices)
const streamRunning = computed(() => hardwareStore.dataStreamStatus.value.running)

const wires = ref<
  Array<{ id: string; x1: number; y1: number; x2: number; y2: number; color: string }>
>([])

const internalSelectedDeviceId = ref<string | null>(null)
const selectedDeviceId = computed(() => props.selectedDeviceId ?? internalSelectedDeviceId.value)

const deviceRendererByType: Record<CanvasDeviceType, Component> = {
  led: LedDevice,
  switch: SwitchDevice,
  button: ButtonDevice,
  keypad: GenericPanelDevice,
  small_keypad: GenericPanelDevice,
  rotary_button: GenericPanelDevice,
  ps2_keyboard: GenericPanelDevice,
  text_lcd: GenericPanelDevice,
  graphic_lcd: GenericPanelDevice,
  segment_display: SegmentDisplayDevice,
  led_matrix: LedMatrixDevice,
}

let dropIdCounter = 0
const SNAP_GRID = 20
const SNAP_ANIMATION_MS = 180
const snapAnimationTimers = new Map<string, number>()

// Canvas Navigation
function handleWheel(e: WheelEvent) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault()
    const zoomSensitivity = 0.001
    const newScale = Math.max(0.1, Math.min(5, scale.value - e.deltaY * zoomSensitivity))
    scale.value = newScale
  } else {
    offset.value.x -= e.deltaX
    offset.value.y -= e.deltaY
  }
}

function startPan(e: MouseEvent) {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    // Middle click or Alt+Left
    isDraggingCanvas.value = true
    lastMousePos.value = { x: e.clientX, y: e.clientY }
    return
  }

  if (e.button === 0) {
    setSelectedDeviceId(null)
  }
}

function pan(e: MouseEvent) {
  if (!isDraggingCanvas.value) return
  const dx = e.clientX - lastMousePos.value.x
  const dy = e.clientY - lastMousePos.value.y
  offset.value.x += dx
  offset.value.y += dy
  lastMousePos.value = { x: e.clientX, y: e.clientY }
}

function endPan() {
  isDraggingCanvas.value = false
}

// Device Interaction
function setSelectedDeviceId(id: string | null) {
  internalSelectedDeviceId.value = id
  emit('update:selectedDeviceId', id)
}

function selectDevice(id: string) {
  setSelectedDeviceId(id)
}

function updateDevicePosition(id: string, x: number, y: number) {
  clearSnapAnimation(id)
  delete animatingDeviceIds.value[id]
  transientDevicePositions.value[id] = { x, y }
}

function openDeviceSettings(id: string) {
  setSelectedDeviceId(id)
  emit('open-settings', id)
}

async function renameDevice(id: string, label: string) {
  const device = devices.value.find((candidate) => candidate.id === id)
  if (!device || device.label === label) {
    return
  }

  await hardwareStore.upsertCanvasDevice({
    ...device,
    label,
  })
}

function removeDevice(id: string) {
  clearSnapAnimation(id)
  delete animatingDeviceIds.value[id]
  delete transientDevicePositions.value[id]

  if (selectedDeviceId.value === id) {
    setSelectedDeviceId(null)
  }

  void hardwareStore.removeCanvasDevice(id)
}

function snapToGrid(value: number) {
  return Math.round(value / SNAP_GRID) * SNAP_GRID
}

function clearSnapAnimation(id: string) {
  const timer = snapAnimationTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    snapAnimationTimers.delete(id)
  }
}

function runNextFrame(callback: () => void) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      callback()
    })
    return
  }

  window.setTimeout(callback, 16)
}

function resolveCanvasPlacement(clientX: number, clientY: number) {
  if (!canvasRef.value) {
    return null
  }

  const rect = canvasRef.value.getBoundingClientRect()
  const visibleTop = rect.top + (props.blockedTopInset ?? 0)
  const insideCanvas =
    clientX >= rect.left && clientX <= rect.right && clientY >= visibleTop && clientY <= rect.bottom

  if (!insideCanvas) {
    return null
  }

  return {
    x: (clientX - rect.left - offset.value.x) / scale.value,
    y: (clientY - rect.top - offset.value.y) / scale.value,
  }
}

function devicePosition(device: CanvasDeviceSnapshot) {
  return transientDevicePositions.value[device.id] ?? { x: device.x, y: device.y }
}

function isDeviceAnimating(id: string) {
  return Boolean(animatingDeviceIds.value[id])
}

async function settleDevicePosition(id: string, x: number, y: number) {
  await hardwareStore.setCanvasDevicePosition(id, x, y)
  delete transientDevicePositions.value[id]
  delete animatingDeviceIds.value[id]
  clearSnapAnimation(id)
}

function animateDeviceToGrid(id: string, x: number, y: number) {
  const snappedX = snapToGrid(x)
  const snappedY = snapToGrid(y)

  clearSnapAnimation(id)
  transientDevicePositions.value[id] = { x, y }

  if (snappedX === x && snappedY === y) {
    void settleDevicePosition(id, snappedX, snappedY)
    return
  }

  animatingDeviceIds.value[id] = true

  runNextFrame(() => {
    transientDevicePositions.value[id] = { x: snappedX, y: snappedY }

    const timer = window.setTimeout(() => {
      void settleDevicePosition(id, snappedX, snappedY)
    }, SNAP_ANIMATION_MS)

    snapAnimationTimers.set(id, timer)
  })
}

function finishDeviceDrag(id: string, x: number, y: number) {
  animateDeviceToGrid(id, x, y)
}

async function createDeviceAt(type: CanvasDeviceType, clientX: number, clientY: number) {
  const placement = resolveCanvasPlacement(clientX, clientY)
  if (!placement) {
    return
  }

  const nextIndex = devices.value.length
  const device: CanvasDeviceSnapshot = createCanvasDeviceSnapshot(
    type,
    nextCanvasDeviceId(),
    placement.x,
    placement.y,
    nextIndex,
  )

  await hardwareStore.upsertCanvasDevice(device)
  animateDeviceToGrid(device.id, placement.x, placement.y)
}

function nextCanvasDeviceId(): string {
  const id = `${Date.now().toString(36)}-${dropIdCounter.toString(36)}`
  dropIdCounter += 1
  return id
}

function toggleSwitch(device: CanvasDeviceSnapshot, value: boolean) {
  void hardwareStore.setCanvasSwitchState(device.id, value)
}

function renderedDevice(device: CanvasDeviceSnapshot): CanvasDeviceSnapshot {
  if (!streamRunning.value) {
    return {
      ...device,
      state: {
        ...device.state,
        is_on: false,
      },
    }
  }

  const boundSignal = getCanvasDeviceBoundSignal(device)
  if (!boundSignal || !deviceReceivesSignal(device.type)) {
    return device
  }

  const telemetry = hardwareStore.signalTelemetry.value[boundSignal]
  if (!telemetry) {
    return device
  }

  return {
    ...device,
    state: {
      ...device.state,
      is_on: telemetry.latest,
    },
  }
}

function rendererProps(device: CanvasDeviceSnapshot) {
  const resolvedDevice = renderedDevice(device)
  const telemetry = streamRunning.value ? hardwareStore.deviceTelemetry.value[device.id] : undefined

  if (isCanvasMatrixDevice(device.type)) {
    const dimensions = getCanvasMatrixDimensions(resolvedDevice)
    const baseProps = getCanvasDeviceRendererProps(resolvedDevice)
    return {
      ...baseProps,
      columns: telemetry?.pixel_columns || dimensions?.columns || 8,
      rows: telemetry?.pixel_rows || dimensions?.rows || 8,
      pixels: streamRunning.value ? (telemetry?.pixels ?? []) : [],
    }
  }

  if (isCanvasSegmentDisplayDevice(device.type)) {
    const config = getCanvasSegmentDisplayConfig(resolvedDevice)
    const baseProps = getCanvasDeviceRendererProps(resolvedDevice)
    const digits = config?.digits || 1
    return {
      ...baseProps,
      digitSegmentMasks: streamRunning.value
        ? (telemetry?.digit_segment_masks ??
          Array.from({ length: digits }, (_, index) => {
            return index === 0 ? (telemetry?.segment_mask ?? 0) : 0
          }))
        : Array.from({ length: digits }, () => 0),
      segmentMask: streamRunning.value ? (telemetry?.segment_mask ?? 0) : 0,
    }
  }

  switch (device.type) {
    default:
      return getCanvasDeviceRendererProps(resolvedDevice)
  }
}

function rendererListeners(
  device: CanvasDeviceSnapshot,
): Record<string, (value: boolean) => void> | undefined {
  if (!canvasDeviceEmitsToggle(device.type)) {
    return undefined
  }

  return {
    toggle: (value: boolean) => {
      toggleSwitch(device, value)
    },
  }
}

function boundSignalsCount(device: CanvasDeviceSnapshot) {
  return getCanvasDeviceBoundSignalCount(device)
}

const palettePreview = computed<CanvasDeviceSnapshot | null>(() => {
  if (!paletteDragStore.state.active || !paletteDragStore.state.type) {
    return null
  }

  const placement = resolveCanvasPlacement(
    paletteDragStore.state.clientX,
    paletteDragStore.state.clientY,
  )
  if (!placement) {
    return null
  }

  return createCanvasDeviceSnapshot(
    paletteDragStore.state.type,
    '__palette-preview__',
    placement.x,
    placement.y,
    devices.value.length,
  )
})

watch(
  () => paletteDragStore.state.pendingDrop?.nonce,
  (nonce) => {
    if (!nonce || !paletteDragStore.state.pendingDrop) {
      return
    }

    const drop = paletteDragStore.state.pendingDrop
    createDeviceAt(drop.type, drop.clientX, drop.clientY)
    consumePaletteDrop(nonce)
  },
)

onMounted(() => {
  void hardwareStore.syncState()
})
</script>

<template>
  <div
    ref="canvasRef"
    class="w-full h-full bg-background overflow-hidden relative cursor-default transition-colors"
    :class="palettePreview ? 'ring-1 ring-primary/40 ring-inset' : ''"
    @wheel="handleWheel"
    @mousedown="startPan"
    @mousemove="pan"
    @mouseup="endPan"
    @mouseleave="endPan"
  >
    <!-- Grid Background -->
    <div
      class="absolute inset-0 pointer-events-none opacity-10"
      :style="{
        backgroundImage: `radial-gradient(currentColor 1px, transparent 1px)`,
        backgroundSize: `${20 * scale}px ${20 * scale}px`,
        backgroundPosition: `${offset.x}px ${offset.y}px`,
        color: 'var(--foreground)',
      }"
    ></div>

    <!-- World Container -->
    <div
      class="absolute origin-top-left will-change-transform"
      :style="{
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
      }"
    >
      <!-- Wires Layer -->
      <WireLayer :wires="wires" />

      <!-- Devices Layer -->
      <BaseDevice
        v-for="device in devices"
        :key="device.id"
        :id="device.id"
        :x="devicePosition(device).x"
        :y="devicePosition(device).y"
        :label="device.label"
        :selected="selectedDeviceId === device.id"
        :bound-signal="getCanvasDeviceBoundSignal(device) || undefined"
        :bound-signals-count="boundSignalsCount(device)"
        :scale="scale"
        :animated="isDeviceAnimating(device.id)"
        @select="selectDevice(device.id)"
        @update:position="(x, y) => updateDevicePosition(device.id, x, y)"
        @drag-end="(id, x, y) => finishDeviceDrag(id, x, y)"
        @open-settings="openDeviceSettings"
        @delete="removeDevice"
        @rename="renameDevice"
      >
        <component
          :is="deviceRendererByType[device.type]"
          v-bind="rendererProps(device)"
          v-on="rendererListeners(device)"
        />
      </BaseDevice>

      <BaseDevice
        v-if="palettePreview"
        id="__palette-preview__"
        :x="palettePreview.x"
        :y="palettePreview.y"
        :label="palettePreview.label"
        :scale="scale"
        :preview="true"
      >
        <component
          :is="deviceRendererByType[palettePreview.type]"
          v-bind="rendererProps(palettePreview)"
        />
      </BaseDevice>
    </div>

    <!-- Overlay Controls -->
    <div
      class="absolute bottom-4 right-4 bg-card/80 backdrop-blur p-2 rounded-md border border-border text-xs"
    >
      Scale: {{ Math.round(scale * 100) }}%
      <br />
      Pos: {{ Math.round(offset.x) }}, {{ Math.round(offset.y) }}
    </div>
  </div>
</template>
