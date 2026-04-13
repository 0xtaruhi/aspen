import type { CanvasDeviceSnapshot, HardwareActionV1, HardwareStateV1 } from '@/lib/hardware-client'

import type { ComputedRef } from 'vue'

type HardwareStoreDispatch = (action: HardwareActionV1) => Promise<HardwareStateV1>

export function createHardwareStoreCanvasActions(
  state: ComputedRef<HardwareStateV1>,
  dispatch: HardwareStoreDispatch,
) {
  async function upsertCanvasDevice(device: CanvasDeviceSnapshot) {
    return dispatch({
      type: 'upsert_canvas_device',
      device,
    })
  }

  async function removeCanvasDevice(id: string) {
    return dispatch({
      type: 'remove_canvas_device',
      id,
    })
  }

  async function clearCanvasDevices() {
    return dispatch({
      type: 'clear_canvas_devices',
    })
  }

  async function replaceCanvasDevices(devices: readonly CanvasDeviceSnapshot[]) {
    await clearCanvasDevices()
    for (const device of devices) {
      await upsertCanvasDevice(device)
    }
    return state.value
  }

  async function setCanvasDevicePosition(id: string, x: number, y: number) {
    return dispatch({
      type: 'set_canvas_device_position',
      id,
      x,
      y,
    })
  }

  async function bindCanvasSignal(id: string, signalName: string | null) {
    return dispatch({
      type: 'bind_canvas_signal',
      id,
      signal_name: signalName,
    })
  }

  async function bindCanvasSignalSlot(id: string, slotIndex: number, signalName: string | null) {
    return dispatch({
      type: 'bind_canvas_signal_slot',
      id,
      slot_index: slotIndex,
      signal_name: signalName,
    })
  }

  async function setCanvasSwitchState(id: string, isOn: boolean) {
    return dispatch({
      type: 'set_canvas_switch_state',
      id,
      is_on: isOn,
    })
  }

  return {
    upsertCanvasDevice,
    removeCanvasDevice,
    clearCanvasDevices,
    replaceCanvasDevices,
    setCanvasDevicePosition,
    bindCanvasSignal,
    bindCanvasSignalSlot,
    setCanvasSwitchState,
  }
}
