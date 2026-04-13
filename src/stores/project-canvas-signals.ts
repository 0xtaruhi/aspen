import type { CanvasDeviceSnapshot, CanvasDeviceType } from '@/lib/hardware-client'

import {
  deviceDrivesSignal as deviceTypeDrivesSignal,
  deviceReceivesSignal as deviceTypeReceivesSignal,
  getCanvasDeviceBoundSignal,
  getCanvasDeviceBoundSignals,
  getCanvasDeviceDrivenSignalLevel,
} from '@/lib/canvas-devices'

function deviceDrivesSignal(type: CanvasDeviceType): boolean {
  return deviceTypeDrivesSignal(type)
}

function deviceReceivesSignal(type: CanvasDeviceType): boolean {
  return deviceTypeReceivesSignal(type)
}

function getBoundSignals(device: CanvasDeviceSnapshot): string[] {
  const boundSignal = getCanvasDeviceBoundSignal(device)
  if (boundSignal) {
    return [boundSignal]
  }

  return getCanvasDeviceBoundSignals(device).filter((signal): signal is string => Boolean(signal))
}

function deviceBindsSignal(device: CanvasDeviceSnapshot, signal: string): boolean {
  return getBoundSignals(device).includes(signal)
}

function signalSourceValue(devices: CanvasDeviceSnapshot[], signal: string): boolean | null {
  const source = devices.find((candidate) => {
    return deviceDrivesSignal(candidate.type) && deviceBindsSignal(candidate, signal)
  })
  return source ? getCanvasDeviceDrivenSignalLevel(source) : null
}

function reconcileReceivedSignalState(
  devices: CanvasDeviceSnapshot[],
  target: CanvasDeviceSnapshot,
): boolean | null {
  const boundSignals = getBoundSignals(target)
  if (boundSignals.length === 0) {
    return null
  }

  let hasSource = false
  let isOn = false

  for (const signal of boundSignals) {
    const sourceValue = signalSourceValue(devices, signal)
    if (sourceValue === null) {
      continue
    }

    hasSource = true
    if (sourceValue) {
      isOn = true
    }
  }

  return hasSource ? isOn : null
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

    if (deviceReceivesSignal(candidate.type) && deviceBindsSignal(candidate, signal)) {
      const reconciledValue = reconcileReceivedSignalState(devices, candidate)
      candidate.state.is_on = reconciledValue ?? value
    }
  }
}

export function propagateDrivenSignalFromCanvasDevice(
  devices: CanvasDeviceSnapshot[],
  sourceDevice: CanvasDeviceSnapshot,
) {
  const signals = getBoundSignals(sourceDevice)
  if (!deviceDrivesSignal(sourceDevice.type) || signals.length === 0) {
    return
  }

  const drivenValue = getCanvasDeviceDrivenSignalLevel(sourceDevice)
  for (const signal of signals) {
    propagateSignalToSubscribers(devices, sourceDevice.id, signal, drivenValue)
  }
}

export function reconcileCanvasBoundSignal(devices: CanvasDeviceSnapshot[], targetId: string) {
  const target = devices.find((candidate) => candidate.id === targetId)
  const targetSignals = target ? getBoundSignals(target) : []
  if (!target || targetSignals.length === 0) {
    return
  }

  if (deviceDrivesSignal(target.type)) {
    propagateDrivenSignalFromCanvasDevice(devices, target)
    return
  }

  if (deviceReceivesSignal(target.type)) {
    const sourceValue = reconcileReceivedSignalState(devices, target)
    if (sourceValue !== null) {
      target.state.is_on = sourceValue
    }
  }
}
