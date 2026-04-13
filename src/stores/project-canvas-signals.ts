import type { CanvasDeviceSnapshot, CanvasDeviceType } from '@/lib/hardware-client'

import {
  deviceDrivesSignal as deviceTypeDrivesSignal,
  deviceReceivesSignal as deviceTypeReceivesSignal,
  getCanvasDeviceBoundSignal,
  getCanvasDeviceDrivenSignalLevel,
} from '@/lib/canvas-devices'

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

export function propagateDrivenSignalFromCanvasDevice(
  devices: CanvasDeviceSnapshot[],
  sourceDevice: CanvasDeviceSnapshot,
) {
  const signal = getCanvasDeviceBoundSignal(sourceDevice)
  if (!deviceDrivesSignal(sourceDevice.type) || !signal) {
    return
  }

  propagateSignalToSubscribers(
    devices,
    sourceDevice.id,
    signal,
    getCanvasDeviceDrivenSignalLevel(sourceDevice),
  )
}

export function reconcileCanvasBoundSignal(devices: CanvasDeviceSnapshot[], targetId: string) {
  const target = devices.find((candidate) => candidate.id === targetId)
  const targetSignal = target ? getCanvasDeviceBoundSignal(target) : null
  if (!target || !targetSignal) {
    return
  }

  if (deviceDrivesSignal(target.type)) {
    propagateDrivenSignalFromCanvasDevice(devices, target)
    return
  }

  if (deviceReceivesSignal(target.type)) {
    const sourceValue = signalSourceValue(devices, targetSignal)
    if (sourceValue !== null) {
      target.state.is_on = sourceValue
    }
  }
}
