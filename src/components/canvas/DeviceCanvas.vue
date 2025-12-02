<script setup lang="ts">
import { ref } from 'vue'
import BaseDevice from '../devices/BaseDevice.vue'
import WireLayer from './WireLayer.vue'
import LedDevice from '../devices/LedDevice.vue'
import SwitchDevice from '../devices/SwitchDevice.vue'

const canvasRef = ref<HTMLElement | null>(null)

// State
const scale = ref(1)
const offset = ref({ x: 0, y: 0 })
const isDraggingCanvas = ref(false)
const lastMousePos = ref({ x: 0, y: 0 })

// Mock Devices
const devices = ref([
    { id: '1', type: 'led', x: 100, y: 100, label: 'LED 0', state: { isOn: false, color: 'red' } },
    { id: '2', type: 'switch', x: 300, y: 100, label: 'SW 0', state: { isOn: false } },
])

const wires = ref([
    { id: 'w1', x1: 340, y1: 140, x2: 140, y2: 140, color: '#666' }
])

const selectedDeviceId = ref<string | null>(null)

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
    if (e.button === 1 || (e.button === 0 && e.altKey)) { // Middle click or Alt+Left
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
    const device = devices.value.find(d => d.id === id)
    if (device) {
        device.x = x
        device.y = y
    }
}

function handleDrop(e: DragEvent) {
    const type = e.dataTransfer?.getData('deviceType')
    if (type && canvasRef.value) {
        const rect = canvasRef.value.getBoundingClientRect()
        const x = (e.clientX - rect.left - offset.value.x) / scale.value
        const y = (e.clientY - rect.top - offset.value.y) / scale.value
        
        devices.value.push({
            id: Date.now().toString(),
            type,
            x,
            y,
            label: `${type.toUpperCase()} ${devices.value.length}`,
            state: { isOn: false, color: 'red' }
        })
    }
}

function toggleSwitch(device: any, value: boolean) {
    device.state.isOn = value
    // In a real app, this would trigger a signal update to the backend
}
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
                color: 'var(--foreground)'
            }"
        ></div>

        <!-- World Container -->
        <div 
            class="absolute origin-top-left will-change-transform"
            :style="{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`
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
                @select="selectDevice(device.id)"
                @update:position="(x, y) => updateDevicePosition(device.id, x, y)"
            >
                <LedDevice 
                    v-if="device.type === 'led'" 
                    :is-on="device.state.isOn" 
                    :color="device.state.color" 
                />
                <SwitchDevice 
                    v-else-if="device.type === 'switch'" 
                    :is-on="device.state.isOn" 
                    @toggle="(val) => toggleSwitch(device, val)"
                />
                <div v-else class="w-16 h-16 bg-zinc-800 rounded flex items-center justify-center text-xs text-muted-foreground">
                    Unknown
                </div>
            </BaseDevice>
        </div>
        
        <!-- Overlay Controls -->
        <div class="absolute bottom-4 right-4 bg-card/80 backdrop-blur p-2 rounded-md border border-border text-xs">
            Scale: {{ Math.round(scale * 100) }}%
            <br>
            Pos: {{ Math.round(offset.x) }}, {{ Math.round(offset.y) }}
        </div>
    </div>
</template>
