<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import BaseDevice from '../devices/BaseDevice.vue'
import WireLayer from './WireLayer.vue'
import { useCanvasDeviceDrag } from './use-canvas-device-drag'
import {
  useCanvasViewportSelection,
  type CanvasInteractionMode,
} from './use-canvas-viewport-selection'
import {
  type CanvasDeviceRendererListeners,
  buildCanvasDeviceRendererListeners,
  buildCanvasDeviceRendererProps,
  getCanvasDeviceRenderer,
} from '@/components/virtual-device/registry'
import type { CanvasDeviceSnapshot, CanvasDeviceType } from '@/lib/hardware-client'
import { snapToGrid } from '@/lib/canvas-selection'
import {
  appendCanvasDeviceText,
  rotateCanvasDeviceEncoder,
  setCanvasDeviceBit,
  setCanvasDeviceEncoderButton,
  setCanvasDeviceMatrixKey,
} from '@/lib/canvas-device-actions'
import {
  canvasDeviceEmitsToggle,
  createCanvasDeviceSnapshot,
  deviceDrivesSignal,
  deviceReceivesSignal,
  getCanvasDeviceBoundSignal,
  getCanvasDeviceBoundSignalCount,
  getCanvasDeviceShellSize,
} from '@/lib/canvas-devices'
import { hardwareStore } from '@/stores/hardware'
import { consumePaletteDrop, paletteDragStore } from '@/stores/palette-drag'
import { useI18n } from '@/lib/i18n'

type DeviceSelectionMode = 'preserve' | 'replace' | 'toggle'

const props = defineProps<{
  selectedDeviceId?: string | null
  selectedDeviceIds?: string[]
  blockedTopInset?: number
  interactionMode?: CanvasInteractionMode
  streamBusy?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:selectedDeviceId', value: string | null): void
  (e: 'update:selectedDeviceIds', value: string[]): void
  (e: 'clear-canvas'): void
  (e: 'open-settings', value: string): void
}>()

const internalSelectedDeviceId = ref<string | null>(null)
const internalSelectedDeviceIds = ref<string[]>([])
const wires = ref<
  Array<{ id: string; x1: number; y1: number; x2: number; y2: number; color: string }>
>([])

const devices = computed(() => hardwareStore.canvasDevices.value)
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
const hasCanvasDevices = computed(() => devices.value.length > 0)

const { t } = useI18n()

let dropIdCounter = 0
const SNAP_GRID = 20

const {
  animateDeviceToPosition,
  clearDeviceAnimation,
  clearGroupDrag,
  devicePosition,
  finishDeviceDrag,
  isDeviceAnimating,
  startGroupDrag,
  transientDevicePositions,
  updateDevicePosition,
} = useCanvasDeviceDrag({
  devices,
  selectedDeviceIds,
  selectedDeviceIdSet,
  setDevicePosition: (id, x, y) => hardwareStore.setCanvasDevicePosition(id, x, y),
  gridSize: SNAP_GRID,
})

const {
  displayedSelectedDeviceIdSet,
  handleCanvasMouseDown,
  handleWheel,
  isDraggingCanvas,
  offset,
  resolveCanvasPlacement,
  scale,
  selectionOverlayStyle,
  setCanvasElement,
} = useCanvasViewportSelection({
  devices,
  selectedDeviceIds,
  blockedTopInset: computed(() => props.blockedTopInset ?? 0),
  interactionMode: resolvedInteractionMode,
  normalizeSelectedIds,
  setSelectedDevices,
  devicePosition,
  shellSize,
})

function openCanvasContextMenuFromKeyboard(event: KeyboardEvent) {
  if (event.key !== 'Enter' && event.key !== ' ') {
    return
  }

  event.preventDefault()
  const trigger = event.currentTarget
  if (!(trigger instanceof HTMLElement)) {
    return
  }

  const rect = trigger.getBoundingClientRect()
  trigger.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 2,
      buttons: 0,
    }),
  )
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
  updateDevice(device, (current) => appendCanvasDeviceText(current, value))
}

function setBitsetValue(device: CanvasDeviceSnapshot, index: number, value: boolean) {
  updateDevice(device, (current) => setCanvasDeviceBit(current, index, value))
}

function rotateEncoder(device: CanvasDeviceSnapshot, delta: number) {
  updateDevice(device, (current) => rotateCanvasDeviceEncoder(current, delta))
}

function setEncoderButton(device: CanvasDeviceSnapshot, value: boolean) {
  updateDevice(device, (current) => setCanvasDeviceEncoderButton(current, value))
}

function setMatrixKey(device: CanvasDeviceSnapshot, row: number | null, column: number | null) {
  updateDevice(device, (current) => setCanvasDeviceMatrixKey(current, row, column))
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
): CanvasDeviceRendererListeners | undefined {
  const listeners: CanvasDeviceRendererListeners = {}

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
</script>

<template>
  <div
    :ref="setCanvasElement"
    class="w-full h-full bg-transparent overflow-hidden relative transition-colors"
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

    <ContextMenu>
      <ContextMenuTrigger as-child>
        <button
          type="button"
          class="absolute inset-0 bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
          :aria-label="t('clearCanvas')"
          @keydown="openCanvasContextMenuFromKeyboard"
        />
      </ContextMenuTrigger>

      <ContextMenuContent class="w-48">
        <ContextMenuItem
          :disabled="!hasCanvasDevices || props.streamBusy"
          class="text-destructive"
          @select="emit('clear-canvas')"
        >
          {{ t('clearCanvas') }}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>

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
