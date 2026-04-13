import type { CanvasDeviceSnapshot, HardwareActionV1 } from '@/lib/hardware-client'

import { ref } from 'vue'

import { cloneCanvasDeviceSnapshots } from './project-canvas-clone'
import { isProjectCanvasAction } from './project-canvas-actions'
import { reduceProjectCanvasDevices } from './project-canvas-reducer'

const defaultCanvasDevices: CanvasDeviceSnapshot[] = []

const canvasDevices = ref<CanvasDeviceSnapshot[]>([])
resetState()

function setCanvasDevices(devices: readonly CanvasDeviceSnapshot[]) {
  canvasDevices.value = cloneCanvasDeviceSnapshots(devices)
}

function resetState() {
  setCanvasDevices(defaultCanvasDevices)
}

function applyAction(action: HardwareActionV1): boolean {
  if (!isProjectCanvasAction(action)) {
    return false
  }

  setCanvasDevices(reduceProjectCanvasDevices(canvasDevices.value, action))
  return true
}

export type { ProjectCanvasAction } from './project-canvas-actions'
export { isProjectCanvasAction } from './project-canvas-actions'

export const projectCanvasStore = {
  canvasDevices,
  setCanvasDevices,
  resetState,
  applyAction,
}
