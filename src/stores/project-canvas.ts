import type {
  CanvasDeviceSnapshot,
  CanvasDeviceType,
  HardwareActionV1,
} from '@/lib/hardware-client'

import { ref, toRaw } from 'vue'

import {
  deviceDrivesSignal as deviceTypeDrivesSignal,
  deviceReceivesSignal as deviceTypeReceivesSignal,
  getCanvasDeviceBoundSignal,
  getCanvasDeviceDrivenSignalLevel,
} from '@/lib/canvas-devices'

export type ProjectCanvasAction = Extract<
  HardwareActionV1,
  | { type: 'upsert_canvas_device' }
  | { type: 'remove_canvas_device' }
  | { type: 'clear_canvas_devices' }
  | { type: 'set_canvas_device_position' }
  | { type: 'bind_canvas_signal' }
  | { type: 'bind_canvas_signal_slot' }
  | { type: 'set_canvas_switch_state' }
>

export function isProjectCanvasAction(action: HardwareActionV1): action is ProjectCanvasAction {
  return (
    action.type === 'upsert_canvas_device' ||
    action.type === 'remove_canvas_device' ||
    action.type === 'clear_canvas_devices' ||
    action.type === 'set_canvas_device_position' ||
    action.type === 'bind_canvas_signal' ||
    action.type === 'bind_canvas_signal_slot' ||
    action.type === 'set_canvas_switch_state'
  )
}

const defaultCanvasDevices: CanvasDeviceSnapshot[] = []

const canvasDevices = ref<CanvasDeviceSnapshot[]>([])
resetState()

function cloneDevice(device: CanvasDeviceSnapshot): CanvasDeviceSnapshot {
  if (typeof structuredClone === 'function') {
    return structuredClone(toRaw(device))
  }

  return JSON.parse(JSON.stringify(device)) as CanvasDeviceSnapshot
}

function cloneCanvasDevices(
  devices: readonly CanvasDeviceSnapshot[] = canvasDevices.value,
): CanvasDeviceSnapshot[] {
  return devices.map((device) => cloneDevice(device))
}

function setCanvasDevices(devices: readonly CanvasDeviceSnapshot[]) {
  canvasDevices.value = cloneCanvasDevices(devices)
}

function resetState() {
  setCanvasDevices(defaultCanvasDevices)
}

function deviceDrivesSignal(type: CanvasDeviceType): boolean {
  return deviceTypeDrivesSignal(type)
}

function deviceReceivesSignal(type: CanvasDeviceType): boolean {
  return deviceTypeReceivesSignal(type)
}

function signalSourceValue(devices: CanvasDeviceSnapshot[], signal: string): boolean | null {
  const source = devices.find((candidate) => {
    return deviceDrivesSignal(candidate.type) && getCanvasDeviceBoundSignal(candidate) === signal
  })
  return source ? getCanvasDeviceDrivenSignalLevel(source) : null
}

function propagateSignalToSubscribers(
  devices: CanvasDeviceSnapshot[],
  sourceId: string,
  signal: string,
  value: boolean,
) {
  for (const candidate of devices) {
    if (candidate.id === sourceId) {
      continue
    }

    if (deviceReceivesSignal(candidate.type) && getCanvasDeviceBoundSignal(candidate) === signal) {
      candidate.state.is_on = value
    }
  }
}

function reconcileBoundSignal(devices: CanvasDeviceSnapshot[], targetId: string) {
  const target = devices.find((candidate) => candidate.id === targetId)
  const targetSignal = target ? getCanvasDeviceBoundSignal(target) : null
  if (!target || !targetSignal) {
    return
  }

  const signal = targetSignal
  if (deviceDrivesSignal(target.type)) {
    propagateSignalToSubscribers(
      devices,
      target.id,
      signal,
      getCanvasDeviceDrivenSignalLevel(target),
    )
    return
  }

  if (deviceReceivesSignal(target.type)) {
    const sourceValue = signalSourceValue(devices, signal)
    if (sourceValue !== null) {
      target.state.is_on = sourceValue
    }
  }
}

function applyAction(action: HardwareActionV1): boolean {
  if (!isProjectCanvasAction(action)) {
    return false
  }

  const nextDevices = cloneCanvasDevices()

  switch (action.type) {
    case 'upsert_canvas_device': {
      const index = nextDevices.findIndex((device) => device.id === action.device.id)
      if (index >= 0) {
        nextDevices[index] = cloneDevice(action.device)
      } else {
        nextDevices.push(cloneDevice(action.device))
      }
      break
    }
    case 'remove_canvas_device': {
      setCanvasDevices(nextDevices.filter((device) => device.id !== action.id))
      return true
    }
    case 'clear_canvas_devices': {
      setCanvasDevices([])
      return true
    }
    case 'set_canvas_device_position': {
      const device = nextDevices.find((item) => item.id === action.id)
      if (device) {
        device.x = action.x
        device.y = action.y
      }
      break
    }
    case 'bind_canvas_signal': {
      const device = nextDevices.find((item) => item.id === action.id)
      if (device && device.state.binding.kind === 'single') {
        device.state.binding.signal = action.signal_name ?? null
        reconcileBoundSignal(nextDevices, action.id)
      }
      break
    }
    case 'bind_canvas_signal_slot': {
      const device = nextDevices.find((item) => item.id === action.id)
      if (device && device.state.binding.kind === 'slots') {
        while (device.state.binding.signals.length <= action.slot_index) {
          device.state.binding.signals.push(null)
        }
        device.state.binding.signals[action.slot_index] = action.signal_name ?? null
      }
      break
    }
    case 'set_canvas_switch_state': {
      const device = nextDevices.find((item) => item.id === action.id)
      if (device) {
        device.state.is_on = action.is_on

        const signal = getCanvasDeviceBoundSignal(device)
        if (deviceDrivesSignal(device.type) && signal) {
          propagateSignalToSubscribers(
            nextDevices,
            device.id,
            signal,
            getCanvasDeviceDrivenSignalLevel(device),
          )
        }
      }
      break
    }
  }

  setCanvasDevices(nextDevices)
  return true
}

export const projectCanvasStore = {
  canvasDevices,
  setCanvasDevices,
  resetState,
  applyAction,
}
