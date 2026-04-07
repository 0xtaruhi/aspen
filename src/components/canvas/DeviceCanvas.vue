<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch, type CSSProperties } from 'vue'

import BaseDevice from '../devices/BaseDevice.vue'
import WireLayer from './WireLayer.vue'
import {
  buildCanvasDeviceRendererListeners,
  buildCanvasDeviceRendererProps,
  getCanvasDeviceRenderer,
} from '@/components/virtual-device/registry'
import type { CanvasDeviceSnapshot, CanvasDeviceType } from '@/lib/hardware-client'
import {
  buildDraggedPositions,
  collectIntersectingBoundsIds,
  normalizeCanvasRect,
  snapDraggedPositions,
  snapToGrid,
  type CanvasPoint,
} from '@/lib/canvas-selection'
import {
  canvasDeviceEmitsToggle,
  createCanvasDeviceSnapshot,
  deviceDrivesSignal,
  deviceReceivesSignal,
  getCanvasBitsetData,
  getCanvasDeviceBoundSignal,
  getCanvasDeviceBoundSignalCount,
  getCanvasDeviceShellSize,
  getCanvasDipSwitchBankConfig,
  getCanvasQuadratureEncoderData,
} from '@/lib/canvas-devices'
import { hardwareStore } from '@/stores/hardware'
import { consumePaletteDrop, paletteDragStore } from '@/stores/palette-drag'

type DeviceSelectionMode = 'preserve' | 'replace' | 'toggle'
type CanvasInteractionMode = 'select' | 'pan'

type DragSelectionState = {
  append: boolean
  baseSelectedIds: string[]
  currentClientX: number
  currentClientY: number
  startClientX: number
  startClientY: number
}

type GroupDragState = {
  ids: string[]
  leaderId: string
  startPositions: Record<string, CanvasPoint>
}

const props = defineProps<{
  selectedDeviceId?: string | null
  selectedDeviceIds?: string[]
  blockedTopInset?: number
  interactionMode?: CanvasInteractionMode
}>()

const emit = defineEmits<{
  (e: 'update:selectedDeviceId', value: string | null): void
  (e: 'update:selectedDeviceIds', value: string[]): void
  (e: 'open-settings', value: string): void
}>()

const canvasRef = ref<HTMLElement | null>(null)
const scale = ref(1)
const offset = ref({ x: 0, y: 0 })
const isDraggingCanvas = ref(false)
const lastMousePos = ref({ x: 0, y: 0 })
const selectionState = ref<DragSelectionState | null>(null)
const transientDevicePositions = ref<Record<string, { x: number; y: number }>>({})
const animatingDeviceIds = ref<Record<string, boolean>>({})
const groupDragState = ref<GroupDragState | null>(null)
const internalSelectedDeviceId = ref<string | null>(null)
const internalSelectedDeviceIds = ref<string[]>([])
const wires = ref<
  Array<{ id: string; x1: number; y1: number; x2: number; y2: number; color: string }>
>([])

const devices = computed(() => hardwareStore.state.value.canvas_devices)
const streamRunning = computed(() => hardwareStore.dataStreamStatus.value.running)
const sampleRateHz = computed(() => {
  return (
    hardwareStore.dataStreamStatus.value.actual_hz || hardwareStore.dataStreamStatus.value.target_hz
  )
})
const selectedDeviceIds = computed(() => {
  if (props.selectedDeviceIds !== undefined) {
    return props.selectedDeviceIds
  }

  if (props.selectedDeviceId !== undefined) {
    return props.selectedDeviceId ? [props.selectedDeviceId] : []
  }

  return internalSelectedDeviceIds.value
})
const selectedDeviceIdSet = computed(() => new Set(selectedDeviceIds.value))
const resolvedInteractionMode = computed<CanvasInteractionMode>(
  () => props.interactionMode ?? 'select',
)

let dropIdCounter = 0
const SNAP_GRID = 20
const SNAP_ANIMATION_MS = 180
const MARQUEE_THRESHOLD_PX = 4
const snapAnimationTimers = new Map<string, number>()

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

function normalizeSelectedIds(ids: readonly string[]) {
  const availableIds = new Set(devices.value.map((device) => device.id))
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const id of ids) {
    if (!availableIds.has(id) || seen.has(id)) {
      continue
    }

    seen.add(id)
    normalized.push(id)
  }

  return normalized
}

function setSelectedDevices(ids: readonly string[], primaryId: string | null = null) {
  const normalizedIds = normalizeSelectedIds(ids)
  const nextPrimaryId =
    normalizedIds.length === 1
      ? primaryId && normalizedIds.includes(primaryId)
        ? primaryId
        : (normalizedIds[0] ?? null)
      : null

  internalSelectedDeviceIds.value = normalizedIds
  internalSelectedDeviceId.value = nextPrimaryId
  emit('update:selectedDeviceIds', [...normalizedIds])
  emit('update:selectedDeviceId', nextPrimaryId)
}

function selectDevice(id: string, mode: DeviceSelectionMode) {
  if (mode === 'preserve') {
    if (selectedDeviceIdSet.value.has(id)) {
      setSelectedDevices(selectedDeviceIds.value, selectedDeviceIds.value.length === 1 ? id : null)
      return
    }

    setSelectedDevices([id], id)
    return
  }

  if (mode === 'replace') {
    setSelectedDevices([id], id)
    return
  }

  const nextIds = selectedDeviceIdSet.value.has(id)
    ? selectedDeviceIds.value.filter((selectedId) => selectedId !== id)
    : [...selectedDeviceIds.value, id]
  setSelectedDevices(nextIds, nextIds.length === 1 ? (nextIds[0] ?? null) : null)
}

function startPan(e: MouseEvent) {
  isDraggingCanvas.value = true
  lastMousePos.value = { x: e.clientX, y: e.clientY }
  window.addEventListener('mousemove', handleWindowMouseMove)
  window.addEventListener('mouseup', handleWindowMouseUp)
}

function startSelection(e: MouseEvent) {
  selectionState.value = {
    append: e.shiftKey || e.metaKey,
    baseSelectedIds: e.shiftKey || e.metaKey ? [...selectedDeviceIds.value] : [],
    currentClientX: e.clientX,
    currentClientY: e.clientY,
    startClientX: e.clientX,
    startClientY: e.clientY,
  }
  window.addEventListener('mousemove', handleWindowMouseMove)
  window.addEventListener('mouseup', handleWindowMouseUp)
}

function handleCanvasMouseDown(e: MouseEvent) {
  if (e.button === 1 || (e.button === 0 && e.altKey)) {
    e.preventDefault()
    startPan(e)
    return
  }

  if (e.button !== 0) {
    return
  }

  e.preventDefault()
  if (resolvedInteractionMode.value === 'pan') {
    startPan(e)
    return
  }

  startSelection(e)
}

function handleWindowMouseMove(e: MouseEvent) {
  if (isDraggingCanvas.value) {
    const dx = e.clientX - lastMousePos.value.x
    const dy = e.clientY - lastMousePos.value.y
    offset.value.x += dx
    offset.value.y += dy
    lastMousePos.value = { x: e.clientX, y: e.clientY }
    return
  }

  if (!selectionState.value) {
    return
  }

  selectionState.value = {
    ...selectionState.value,
    currentClientX: e.clientX,
    currentClientY: e.clientY,
  }
}

function removeWindowMouseListeners() {
  window.removeEventListener('mousemove', handleWindowMouseMove)
  window.removeEventListener('mouseup', handleWindowMouseUp)
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

function resolveCanvasPoint(clientX: number, clientY: number) {
  if (!canvasRef.value) {
    return null
  }

  const rect = canvasRef.value.getBoundingClientRect()
  return {
    x: (clientX - rect.left - offset.value.x) / scale.value,
    y: (clientY - rect.top - offset.value.y) / scale.value,
  }
}

function clampToCanvas(clientX: number, clientY: number) {
  if (!canvasRef.value) {
    return null
  }

  const rect = canvasRef.value.getBoundingClientRect()
  return {
    x: Math.max(0, Math.min(rect.width, clientX - rect.left)),
    y: Math.max(0, Math.min(rect.height, clientY - rect.top)),
  }
}

function selectionMovedEnough(state: DragSelectionState) {
  return (
    Math.abs(state.currentClientX - state.startClientX) >= MARQUEE_THRESHOLD_PX ||
    Math.abs(state.currentClientY - state.startClientY) >= MARQUEE_THRESHOLD_PX
  )
}

function collectSelectionIds(state: DragSelectionState) {
  const start = resolveCanvasPoint(state.startClientX, state.startClientY)
  const end = resolveCanvasPoint(state.currentClientX, state.currentClientY)
  if (!start || !end) {
    return state.append ? [...state.baseSelectedIds] : []
  }

  const ids = collectIntersectingBoundsIds(
    normalizeCanvasRect(start, end),
    devices.value.map((device) => {
      const position = devicePosition(device)
      const size = shellSize(device)
      return {
        id: device.id,
        x: position.x,
        y: position.y,
        width: size.width,
        height: size.height,
      }
    }),
  )

  return state.append ? [...state.baseSelectedIds, ...ids] : ids
}

const selectionOverlayStyle = computed<CSSProperties | null>(() => {
  if (!selectionState.value || !canvasRef.value) {
    return null
  }

  const start = clampToCanvas(selectionState.value.startClientX, selectionState.value.startClientY)
  const end = clampToCanvas(
    selectionState.value.currentClientX,
    selectionState.value.currentClientY,
  )
  if (!start || !end) {
    return null
  }

  const rect = normalizeCanvasRect(start, end)
  return {
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  }
})

const displayedSelectedDeviceIds = computed(() => {
  if (!selectionState.value || !selectionMovedEnough(selectionState.value)) {
    return selectedDeviceIds.value
  }

  return normalizeSelectedIds(collectSelectionIds(selectionState.value))
})

const displayedSelectedDeviceIdSet = computed(() => new Set(displayedSelectedDeviceIds.value))

function finishSelection() {
  const currentSelection = selectionState.value
  selectionState.value = null

  if (!currentSelection) {
    return
  }

  if (!selectionMovedEnough(currentSelection)) {
    if (!currentSelection.append) {
      setSelectedDevices([], null)
    }
    return
  }

  const nextIds = normalizeSelectedIds(collectSelectionIds(currentSelection))
  setSelectedDevices(nextIds, nextIds.length === 1 ? (nextIds[0] ?? null) : null)
}

function handleWindowMouseUp() {
  if (isDraggingCanvas.value) {
    isDraggingCanvas.value = false
  }

  if (selectionState.value) {
    finishSelection()
  }

  removeWindowMouseListeners()
}

function clearGroupDrag() {
  groupDragState.value = null
}

function startGroupDrag(id: string) {
  if (!selectedDeviceIdSet.value.has(id) || selectedDeviceIds.value.length <= 1) {
    clearGroupDrag()
    return
  }

  const startPositions = Object.fromEntries(
    selectedDeviceIds.value.flatMap((selectedId) => {
      const device = devices.value.find((candidate) => candidate.id === selectedId)
      if (!device) {
        return []
      }

      const position = devicePosition(device)
      return [[selectedId, { x: position.x, y: position.y }]]
    }),
  )

  groupDragState.value = {
    ids: Object.keys(startPositions),
    leaderId: id,
    startPositions,
  }
}

function devicePosition(device: CanvasDeviceSnapshot) {
  return transientDevicePositions.value[device.id] ?? { x: device.x, y: device.y }
}

function clearSnapAnimation(id: string) {
  const timer = snapAnimationTimers.get(id)
  if (timer) {
    clearTimeout(timer)
    snapAnimationTimers.delete(id)
  }
}

function clearDeviceAnimation(id: string) {
  clearSnapAnimation(id)
  delete animatingDeviceIds.value[id]
}

function updateDevicePosition(id: string, x: number, y: number) {
  const activeGroupDrag = groupDragState.value
  if (activeGroupDrag && activeGroupDrag.leaderId === id) {
    const draggedPositions = buildDraggedPositions(
      activeGroupDrag.ids,
      activeGroupDrag.startPositions,
      id,
      {
        x,
        y,
      },
    )

    for (const [deviceId, position] of Object.entries(draggedPositions)) {
      clearDeviceAnimation(deviceId)
      transientDevicePositions.value[deviceId] = position
    }
    return
  }

  clearDeviceAnimation(id)
  transientDevicePositions.value[id] = { x, y }
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

async function settleDevicePosition(id: string, x: number, y: number) {
  await hardwareStore.setCanvasDevicePosition(id, x, y)
  delete transientDevicePositions.value[id]
  delete animatingDeviceIds.value[id]
  clearSnapAnimation(id)
}

function animateDeviceToPosition(id: string, targetX: number, targetY: number) {
  clearSnapAnimation(id)

  const currentDevice = devices.value.find((device) => device.id === id)
  const resolvedCurrent = transientDevicePositions.value[id]
    ? transientDevicePositions.value[id]
    : currentDevice
      ? { x: currentDevice.x, y: currentDevice.y }
      : null

  if (resolvedCurrent && resolvedCurrent.x === targetX && resolvedCurrent.y === targetY) {
    void settleDevicePosition(id, targetX, targetY)
    return
  }

  animatingDeviceIds.value[id] = true

  runNextFrame(() => {
    transientDevicePositions.value[id] = { x: targetX, y: targetY }

    const timer = window.setTimeout(() => {
      void settleDevicePosition(id, targetX, targetY)
    }, SNAP_ANIMATION_MS)

    snapAnimationTimers.set(id, timer)
  })
}

function finishDeviceDrag(id: string, x: number, y: number) {
  const activeGroupDrag = groupDragState.value
  if (activeGroupDrag && activeGroupDrag.leaderId === id) {
    const snappedPositions = snapDraggedPositions(
      activeGroupDrag.ids,
      activeGroupDrag.startPositions,
      id,
      { x, y },
      SNAP_GRID,
    )

    for (const [deviceId, position] of Object.entries(snappedPositions)) {
      animateDeviceToPosition(deviceId, position.x, position.y)
    }

    clearGroupDrag()
    return
  }

  animateDeviceToPosition(id, snapToGrid(x, SNAP_GRID), snapToGrid(y, SNAP_GRID))
}

function isDeviceAnimating(id: string) {
  return Boolean(animatingDeviceIds.value[id])
}

function openDeviceSettings(id: string) {
  setSelectedDevices([id], id)
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
  clearDeviceAnimation(id)
  delete transientDevicePositions.value[id]
  clearGroupDrag()
  setSelectedDevices(
    selectedDeviceIds.value.filter((selectedId) => selectedId !== id),
    null,
  )
  void hardwareStore.removeCanvasDevice(id)
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
  animateDeviceToPosition(
    device.id,
    snapToGrid(placement.x, SNAP_GRID),
    snapToGrid(placement.y, SNAP_GRID),
  )
}

function nextCanvasDeviceId(): string {
  const id = `${Date.now().toString(36)}-${dropIdCounter.toString(36)}`
  dropIdCounter += 1
  return id
}

function toggleSwitch(device: CanvasDeviceSnapshot, value: boolean) {
  void hardwareStore.setCanvasSwitchState(device.id, value)
}

function updateDevice(
  device: CanvasDeviceSnapshot,
  updater: (device: CanvasDeviceSnapshot) => CanvasDeviceSnapshot,
) {
  void hardwareStore.upsertCanvasDevice(updater(device))
}

function enqueueAsciiText(device: CanvasDeviceSnapshot, value: string) {
  const bytes = Array.from(new TextEncoder().encode(value))
  updateDevice(device, (current) => {
    const existing = current.state.data.kind === 'queued_bytes' ? current.state.data.bytes : []
    return {
      ...current,
      state: {
        ...current.state,
        data: {
          kind: 'queued_bytes',
          bytes: [...existing, ...bytes],
        },
      },
    }
  })
}

function setBitsetValue(device: CanvasDeviceSnapshot, index: number, value: boolean) {
  const config = getCanvasDipSwitchBankConfig(device)
  const width = config?.width ?? 1
  const bits = getCanvasBitsetData(device, width)
  bits[index] = value
  updateDevice(device, (current) => ({
    ...current,
    state: {
      ...current.state,
      data: {
        kind: 'bitset',
        bits,
      },
    },
  }))
}

function rotateEncoder(device: CanvasDeviceSnapshot, delta: number) {
  const data = getCanvasQuadratureEncoderData(device)
  const nextPhase = (((data.phase + delta) % 4) + 4) % 4
  updateDevice(device, (current) => ({
    ...current,
    state: {
      ...current.state,
      data: {
        kind: 'quadrature_encoder',
        phase: nextPhase,
        button_pressed: data.buttonPressed,
      },
    },
  }))
}

function setEncoderButton(device: CanvasDeviceSnapshot, value: boolean) {
  const data = getCanvasQuadratureEncoderData(device)
  updateDevice(device, (current) => ({
    ...current,
    state: {
      ...current.state,
      data: {
        kind: 'quadrature_encoder',
        phase: data.phase,
        button_pressed: value,
      },
    },
  }))
}

function setMatrixKey(device: CanvasDeviceSnapshot, row: number | null, column: number | null) {
  updateDevice(device, (current) => ({
    ...current,
    state: {
      ...current.state,
      data: {
        kind: 'matrix_keypad',
        pressed_row: row,
        pressed_column: column,
      },
    },
  }))
}

function renderedDevice(device: CanvasDeviceSnapshot): CanvasDeviceSnapshot {
  if (!streamRunning.value) {
    if (!deviceReceivesSignal(device.type) || deviceDrivesSignal(device.type)) {
      return device
    }

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
  return buildCanvasDeviceRendererProps(resolvedDevice, {
    streamRunning: streamRunning.value,
    telemetry: streamRunning.value ? hardwareStore.deviceTelemetry.value[device.id] : undefined,
    signalTelemetry: hardwareStore.signalTelemetry.value,
    sampleRateHz: sampleRateHz.value,
  })
}

function rendererListeners(
  device: CanvasDeviceSnapshot,
): Record<string, (...args: any[]) => void> | undefined {
  const listeners: Record<string, (...args: any[]) => void> = {}

  if (canvasDeviceEmitsToggle(device.type)) {
    listeners.toggle = (value: boolean) => {
      toggleSwitch(device, value)
    }
  }

  Object.assign(
    listeners,
    buildCanvasDeviceRendererListeners(device, {
      toggleSwitch,
      setBitsetValue,
      rotateEncoder,
      setEncoderButton,
      setMatrixKey,
      enqueueAsciiText,
    }) ?? {},
  )

  return Object.keys(listeners).length > 0 ? listeners : undefined
}

function boundSignalsCount(device: CanvasDeviceSnapshot) {
  return getCanvasDeviceBoundSignalCount(device)
}

function shellSize(device: CanvasDeviceSnapshot) {
  return getCanvasDeviceShellSize(device)
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
  devices,
  () => {
    const nextIds = normalizeSelectedIds(selectedDeviceIds.value)
    if (nextIds.length !== selectedDeviceIds.value.length) {
      setSelectedDevices(nextIds, nextIds.length === 1 ? (nextIds[0] ?? null) : null)
    }
  },
  { deep: true },
)

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

onUnmounted(() => {
  removeWindowMouseListeners()
  for (const timer of snapAnimationTimers.values()) {
    clearTimeout(timer)
  }
  snapAnimationTimers.clear()
})
</script>

<template>
  <div
    ref="canvasRef"
    class="w-full h-full bg-background overflow-hidden relative transition-colors"
    :class="[
      {
        'cursor-grab': resolvedInteractionMode === 'pan' && !isDraggingCanvas,
        'cursor-grabbing': isDraggingCanvas,
        'cursor-default': resolvedInteractionMode === 'select' && !isDraggingCanvas,
      },
      palettePreview ? 'ring-1 ring-primary/40 ring-inset' : '',
    ]"
    @wheel="handleWheel"
    @mousedown="handleCanvasMouseDown"
  >
    <div
      class="absolute inset-0 pointer-events-none opacity-10"
      :style="{
        backgroundImage: `radial-gradient(currentColor 1px, transparent 1px)`,
        backgroundSize: `${20 * scale}px ${20 * scale}px`,
        backgroundPosition: `${offset.x}px ${offset.y}px`,
        color: 'var(--foreground)',
      }"
    ></div>

    <div
      class="absolute origin-top-left will-change-transform"
      :class="resolvedInteractionMode === 'pan' ? 'pointer-events-none' : ''"
      :style="{
        transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
      }"
    >
      <WireLayer :wires="wires" />

      <BaseDevice
        v-for="device in devices"
        :key="device.id"
        :id="device.id"
        :x="devicePosition(device).x"
        :y="devicePosition(device).y"
        :width="shellSize(device).width"
        :height="shellSize(device).height"
        :label="device.label"
        :selected="displayedSelectedDeviceIdSet.has(device.id)"
        :bound-signal="getCanvasDeviceBoundSignal(device) || undefined"
        :bound-signals-count="boundSignalsCount(device)"
        :scale="scale"
        :animated="isDeviceAnimating(device.id)"
        @select="(id, mode) => selectDevice(id, mode)"
        @update:position="(x, y) => updateDevicePosition(device.id, x, y)"
        @drag-start="startGroupDrag"
        @drag-end="(id, x, y) => finishDeviceDrag(id, x, y)"
        @open-settings="openDeviceSettings"
        @delete="removeDevice"
        @rename="renameDevice"
      >
        <component
          :is="getCanvasDeviceRenderer(device.type)"
          v-bind="rendererProps(device)"
          v-on="rendererListeners(device)"
        />
      </BaseDevice>

      <BaseDevice
        v-if="palettePreview"
        id="__palette-preview__"
        :x="palettePreview.x"
        :y="palettePreview.y"
        :width="shellSize(palettePreview).width"
        :height="shellSize(palettePreview).height"
        :label="palettePreview.label"
        :scale="scale"
        :preview="true"
      >
        <component
          :is="getCanvasDeviceRenderer(palettePreview.type)"
          v-bind="rendererProps(palettePreview)"
        />
      </BaseDevice>
    </div>

    <div
      v-if="resolvedInteractionMode === 'select' && selectionOverlayStyle"
      class="pointer-events-none absolute rounded-md border border-primary/70 bg-primary/10"
      :style="selectionOverlayStyle"
    ></div>

    <div
      class="absolute bottom-4 right-4 bg-card/80 backdrop-blur p-2 rounded-md border border-border text-xs"
      @mousedown.stop
    >
      Scale: {{ Math.round(scale * 100) }}%
      <br />
      Pos: {{ Math.round(offset.x) }}, {{ Math.round(offset.y) }}
    </div>
  </div>
</template>
