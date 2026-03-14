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
} from '@/lib/canvas-devices'

type VirtualDeviceAction = Extract<
  HardwareActionV1,
  | { type: 'upsert_canvas_device' }
  | { type: 'remove_canvas_device' }
  | { type: 'set_canvas_device_position' }
  | { type: 'bind_canvas_signal' }
  | { type: 'set_canvas_switch_state' }
>

function isVirtualDeviceAction(action: HardwareActionV1): action is VirtualDeviceAction {
  return (
    action.type === 'upsert_canvas_device' ||
    action.type === 'remove_canvas_device' ||
    action.type === 'set_canvas_device_position' ||
    action.type === 'bind_canvas_signal' ||
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
    state: { ...device.state },
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
    return deviceDrivesSignal(candidate.type) && candidate.state.bound_signal === signal
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

    if (deviceReceivesSignal(candidate.type) && candidate.state.bound_signal === signal) {
      candidate.state.is_on = value
    }
  }
}

function reconcileBoundSignal(devices: CanvasDeviceSnapshot[], targetId: string) {
  const target = devices.find((candidate) => candidate.id === targetId)
  if (!target || !target.state.bound_signal) {
    return
  }

  const signal = target.state.bound_signal
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
      if (device) {
        device.state.bound_signal = virtualAction.signal_name ?? null
        reconcileBoundSignal(nextDevices, virtualAction.id)
      }
      break
    }
    case 'set_canvas_switch_state': {
      const device = nextDevices.find((item) => item.id === virtualAction.id)
      if (device) {
        device.state.is_on = virtualAction.is_on

        if (deviceDrivesSignal(device.type) && device.state.bound_signal) {
          propagateSignalToSubscribers(
            nextDevices,
            device.id,
            device.state.bound_signal,
            virtualAction.is_on,
          )
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
