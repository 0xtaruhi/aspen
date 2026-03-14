import type { CanvasDeviceSnapshot, HardwareActionV1, HardwareStateV1 } from '@/lib/hardware-client'

import { computed } from 'vue'

import {
  dispatch as dispatchRuntimeAction,
  disconnectView as disconnectRuntimeView,
  hardwareRuntimeStore,
  start as startRuntime,
  stop as stopRuntime,
  syncState as syncRuntimeState,
} from './hardware-runtime'
import { virtualDeviceStore } from './virtual-device'

const state = computed<HardwareStateV1>(() => {
  return {
    ...hardwareRuntimeStore.runtimeState.value,
    canvas_devices: virtualDeviceStore.canvasDevices.value,
  }
})

hardwareRuntimeStore.subscribeHardwareState((nextState) => {
  virtualDeviceStore.setCanvasDevices(nextState.canvas_devices)
})

async function syncState() {
  const nextState = await syncRuntimeState()
  if (nextState) {
    virtualDeviceStore.setCanvasDevices(nextState.canvas_devices)
  }
  return state.value
}

async function dispatch(action: HardwareActionV1) {
  try {
    const nextState = await dispatchRuntimeAction(action)
    if (nextState) {
      virtualDeviceStore.setCanvasDevices(nextState.canvas_devices)
    }
    return state.value
  } catch (err) {
    if (hardwareRuntimeStore.isTauriUnavailable(err)) {
      virtualDeviceStore.applyLocalAction(action)
      return state.value
    }
    throw err
  }
}

async function probe() {
  return dispatch({ type: 'probe' })
}

async function generateBitstream(
  sourceName: string,
  sourceCode: string,
  outputPath?: string | null,
) {
  return dispatch({
    type: 'generate_bitstream',
    source_name: sourceName,
    source_code: sourceCode,
    output_path: outputPath ?? null,
  })
}

async function programBitstream(bitstreamPath?: string | null) {
  return dispatch({
    type: 'program_bitstream',
    bitstream_path: bitstreamPath ?? null,
  })
}

async function clearError() {
  return dispatch({ type: 'clear_error' })
}

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

async function setCanvasSwitchState(id: string, isOn: boolean) {
  return dispatch({
    type: 'set_canvas_switch_state',
    id,
    is_on: isOn,
  })
}

async function start() {
  return startRuntime()
}

async function stop() {
  return stopRuntime()
}

async function disconnectView() {
  await disconnectRuntimeView()
  virtualDeviceStore.resetState()
}

export const hardwareStore = {
  state,
  signalTelemetry: hardwareRuntimeStore.signalTelemetry,
  dataStreamStatus: hardwareRuntimeStore.dataStreamStatus,
  hotplugLog: hardwareRuntimeStore.hotplugLog,
  isStarted: hardwareRuntimeStore.isStarted,
  start,
  stop,
  probe,
  dispatch,
  syncState,
  generateBitstream,
  programBitstream,
  upsertCanvasDevice,
  removeCanvasDevice,
  setCanvasDevicePosition,
  bindCanvasSignal,
  setCanvasSwitchState,
  clearError,
  disconnectView,
}
