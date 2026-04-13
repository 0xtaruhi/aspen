import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'

import { cloneCanvasDeviceSnapshot, cloneCanvasDeviceSnapshots } from './project-canvas-clone'
import type { ProjectCanvasAction } from './project-canvas-actions'
import {
  propagateDrivenSignalFromCanvasDevice,
  reconcileCanvasBoundSignal,
} from './project-canvas-signals'

export function reduceProjectCanvasDevices(
  devices: readonly CanvasDeviceSnapshot[],
  action: ProjectCanvasAction,
): CanvasDeviceSnapshot[] {
  const nextDevices = cloneCanvasDeviceSnapshots(devices)

  switch (action.type) {
    case 'upsert_canvas_device': {
      const index = nextDevices.findIndex((device) => device.id === action.device.id)
      if (index >= 0) {
        nextDevices[index] = cloneCanvasDeviceSnapshot(action.device)
      } else {
        nextDevices.push(cloneCanvasDeviceSnapshot(action.device))
      }
      return nextDevices
    }
    case 'remove_canvas_device':
      return nextDevices.filter((device) => device.id !== action.id)
    case 'clear_canvas_devices':
      return []
    case 'set_canvas_device_position': {
      const device = nextDevices.find((item) => item.id === action.id)
      if (device) {
        device.x = action.x
        device.y = action.y
      }
      return nextDevices
    }
    case 'bind_canvas_signal': {
      const device = nextDevices.find((item) => item.id === action.id)
      if (device && device.state.binding.kind === 'single') {
        device.state.binding.signal = action.signal_name ?? null
        reconcileCanvasBoundSignal(nextDevices, action.id)
      }
      return nextDevices
    }
    case 'bind_canvas_signal_slot': {
      const device = nextDevices.find((item) => item.id === action.id)
      if (
        device &&
        device.state.binding.kind === 'slots' &&
        Number.isInteger(action.slot_index) &&
        action.slot_index >= 0
      ) {
        while (device.state.binding.signals.length <= action.slot_index) {
          device.state.binding.signals.push(null)
        }
        device.state.binding.signals[action.slot_index] = action.signal_name ?? null
      }
      return nextDevices
    }
    case 'set_canvas_switch_state': {
      const device = nextDevices.find((item) => item.id === action.id)
      if (device) {
        device.state.is_on = action.is_on
        propagateDrivenSignalFromCanvasDevice(nextDevices, device)
      }
      return nextDevices
    }
  }
}
