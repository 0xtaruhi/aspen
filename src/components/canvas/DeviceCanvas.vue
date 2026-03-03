<script setup lang="ts">
import { computed, onMounted, ref, type Component } from 'vue'
import BaseDevice from '../devices/BaseDevice.vue'
import WireLayer from './WireLayer.vue'
import LedDevice from '../devices/LedDevice.vue'
import SwitchDevice from '../devices/SwitchDevice.vue'
import { hardwareStore } from '@/stores/hardware'
import type { CanvasDeviceSnapshot, CanvasDeviceType } from '@/lib/hardware-client'
import {
  canvasDeviceEmitsToggle,
  createCanvasDeviceSnapshot,
  getCanvasDeviceRendererProps,
  resolveCanvasDeviceType,
} from '@/lib/canvas-devices'

const canvasRef = ref<HTMLElement | null>(null)

// State
const scale = ref(1)
const offset = ref({ x: 0, y: 0 })
const isDraggingCanvas = ref(false)
const lastMousePos = ref({ x: 0, y: 0 })

const devices = computed(() => hardwareStore.state.value.canvas_devices)

const wires = ref<
  Array<{ id: string; x1: number; y1: number; x2: number; y2: number; color: string }>
>([])

const selectedDeviceId = ref<string | null>(null)

const deviceRendererByType: Record<CanvasDeviceType, Component> = {
  led: LedDevice,
  switch: SwitchDevice,
}

let dropIdCounter = 0

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
function selectDevice(id: string) {
  selectedDeviceId.value = id
}

function updateDevicePosition(id: string, x: number, y: number) {
  void hardwareStore.setCanvasDevicePosition(id, x, y)
}

function bindDeviceSignal(id: string, signalName: string) {
  void hardwareStore.bindCanvasSignal(id, signalName)
}

function handleDrop(e: DragEvent) {
  const rawType =
    e.dataTransfer?.getData('application/x-widget') || e.dataTransfer?.getData('deviceType')
  const type = resolveCanvasDeviceType(rawType)
  if (type && canvasRef.value) {
    const rect = canvasRef.value.getBoundingClientRect()
    const x = (e.clientX - rect.left - offset.value.x) / scale.value
    const y = (e.clientY - rect.top - offset.value.y) / scale.value

    const nextIndex = devices.value.length
    const device: CanvasDeviceSnapshot = createCanvasDeviceSnapshot(
      type,
      nextCanvasDeviceId(),
      x,
      y,
      nextIndex,
    )
    void hardwareStore.upsertCanvasDevice(device)
  }
}

function nextCanvasDeviceId(): string {
  const id = `${Date.now().toString(36)}-${dropIdCounter.toString(36)}`
  dropIdCounter += 1
  return id
}

function toggleSwitch(device: CanvasDeviceSnapshot, value: boolean) {
  void hardwareStore.setCanvasSwitchState(device.id, value)
}

function rendererProps(device: CanvasDeviceSnapshot) {
  return getCanvasDeviceRendererProps(device)
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

onMounted(() => {
  void hardwareStore.syncState()
})
</script>

<template>
  <div
    ref="canvasRef"
    class="w-full h-full bg-background overflow-hidden relative cursor-crosshair transition-colors"
    @wheel="handleWheel"
    @mousedown="startPan"
    @mousemove="pan"
    @mouseup="endPan"
    @mouseleave="endPan"
    @drop="handleDrop"
    @dragover.prevent
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
        :x="device.x"
        :y="device.y"
        :label="device.label"
        :selected="selectedDeviceId === device.id"
        :bound-signal="device.state.bound_signal || undefined"
        @select="selectDevice(device.id)"
        @update:position="(x, y) => updateDevicePosition(device.id, x, y)"
        @bind:signal="(signalName) => bindDeviceSignal(device.id, signalName)"
      >
        <component
          :is="deviceRendererByType[device.type]"
          v-bind="rendererProps(device)"
          v-on="rendererListeners(device)"
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
