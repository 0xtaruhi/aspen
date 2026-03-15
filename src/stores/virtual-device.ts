import type {
  CanvasDeviceSnapshot,
  CanvasDeviceType,
  HardwareActionV1,
} from '@/lib/hardware-client'

import { ref } from 'vue'

import {
  createCanvasDeviceSnapshot,
  deviceDrivesSignal as deviceTypeDrivesSignal,
  deviceReceivesSignal as deviceTypeReceivesSignal,
  getCanvasDeviceBoundSignal,
} from '@/lib/canvas-devices'

type VirtualDeviceAction = Extract<
  HardwareActionV1,
  | { type: 'upsert_canvas_device' }
  | { type: 'remove_canvas_device' }
  | { type: 'clear_canvas_devices' }
  | { type: 'set_canvas_device_position' }
  | { type: 'bind_canvas_signal' }
  | { type: 'bind_canvas_signal_slot' }
  | { type: 'set_canvas_switch_state' }
>

function isVirtualDeviceAction(action: HardwareActionV1): action is VirtualDeviceAction {
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

const defaultCanvasDevices: CanvasDeviceSnapshot[] = [
  createCanvasDeviceSnapshot('led', '1', 100, 100, 0),
  createCanvasDeviceSnapshot('switch', '2', 300, 100, 0),
]

const canvasDevices = ref<CanvasDeviceSnapshot[]>([])
resetState()

function cloneDevice(device: CanvasDeviceSnapshot): CanvasDeviceSnapshot {
  return {
    ...device,
    state: {
      ...device.state,
      binding:
        device.state.binding.kind === 'single'
          ? {
              kind: 'single',
              signal: device.state.binding.signal ?? null,
            }
          : {
              kind: 'slots',
              signals: [...device.state.binding.signals],
            },
      config:
        device.state.config.kind === 'led_matrix'
          ? {
              kind: 'led_matrix',
              rows: device.state.config.rows,
              columns: device.state.config.columns,
            }
          : device.state.config.kind === 'segment_display'
            ? {
                kind: 'segment_display',
                digits: device.state.config.digits,
              }
            : {
                kind: 'none',
              },
    },
  }
}

function cloneCanvasDevices(
  devices: CanvasDeviceSnapshot[] = canvasDevices.value,
): CanvasDeviceSnapshot[] {
  return devices.map((device) => cloneDevice(device))
}

function setCanvasDevices(devices: CanvasDeviceSnapshot[]) {
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
  return source ? source.state.is_on : null
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
    propagateSignalToSubscribers(devices, target.id, signal, target.state.is_on)
    return
  }

  if (deviceReceivesSignal(target.type)) {
    const sourceValue = signalSourceValue(devices, signal)
    if (sourceValue !== null) {
      target.state.is_on = sourceValue
    }
  }
}

function applyLocalAction(action: HardwareActionV1): boolean {
  if (!isVirtualDeviceAction(action)) {
    return false
  }

  const virtualAction = action
  const nextDevices = cloneCanvasDevices()

  switch (virtualAction.type) {
    case 'upsert_canvas_device': {
      const index = nextDevices.findIndex((device) => device.id === virtualAction.device.id)
      if (index >= 0) {
        nextDevices[index] = cloneDevice(virtualAction.device)
      } else {
        nextDevices.push(cloneDevice(virtualAction.device))
      }
      break
    }
    case 'remove_canvas_device': {
      setCanvasDevices(nextDevices.filter((device) => device.id !== virtualAction.id))
      return true
    }
    case 'clear_canvas_devices': {
      setCanvasDevices([])
      return true
    }
    case 'set_canvas_device_position': {
      const device = nextDevices.find((item) => item.id === virtualAction.id)
      if (device) {
        device.x = virtualAction.x
        device.y = virtualAction.y
      }
      break
    }
    case 'bind_canvas_signal': {
      const device = nextDevices.find((item) => item.id === virtualAction.id)
      if (device && device.state.binding.kind === 'single') {
        device.state.binding.signal = virtualAction.signal_name ?? null
        reconcileBoundSignal(nextDevices, virtualAction.id)
      }
      break
    }
    case 'bind_canvas_signal_slot': {
      const device = nextDevices.find((item) => item.id === virtualAction.id)
      if (device && device.state.binding.kind === 'slots') {
        while (device.state.binding.signals.length <= virtualAction.slot_index) {
          device.state.binding.signals.push(null)
        }
        device.state.binding.signals[virtualAction.slot_index] = virtualAction.signal_name ?? null
      }
      break
    }
    case 'set_canvas_switch_state': {
      const device = nextDevices.find((item) => item.id === virtualAction.id)
      if (device) {
        device.state.is_on = virtualAction.is_on

        const signal = getCanvasDeviceBoundSignal(device)
        if (deviceDrivesSignal(device.type) && signal) {
          propagateSignalToSubscribers(nextDevices, device.id, signal, virtualAction.is_on)
        }
      }
      break
    }
  }

  setCanvasDevices(nextDevices)
  return true
}

export const virtualDeviceStore = {
  canvasDevices,
  setCanvasDevices,
  resetState,
  applyLocalAction,
}
