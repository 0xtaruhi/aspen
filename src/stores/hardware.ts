import type { CanvasDeviceSnapshot, HardwareActionV1, HardwareStateV1 } from '@/lib/hardware-client'

import { computed } from 'vue'

import {
  configureDataStream as configureRuntimeDataStream,
  dispatch as dispatchRuntimeAction,
  disconnectView as disconnectRuntimeView,
  hardwareRuntimeStore,
  refreshDataStreamStatus as refreshRuntimeDataStreamStatus,
  setDataStreamRate as setRuntimeDataStreamRate,
  startDataStream as startRuntimeDataStream,
  start as startRuntime,
  stopDataStream as stopRuntimeDataStream,
  stop as stopRuntime,
  syncState as syncRuntimeState,
} from './hardware-runtime'
import { hardwareFlowStore } from './hardware-flow'
import { isProjectCanvasAction, projectCanvasStore } from './project-canvas'

const canvasDevices = computed(() => projectCanvasStore.canvasDevices.value)
const state = computed<HardwareStateV1>(() => {
  return {
    ...hardwareRuntimeStore.runtimeState.value,
    canvas_devices: canvasDevices.value,
  }
})

async function syncState() {
  await syncRuntimeState()
  return state.value
}

async function dispatch(action: HardwareActionV1) {
  try {
    await dispatchRuntimeAction(action)
    if (isProjectCanvasAction(action)) {
      projectCanvasStore.applyAction(action)
    }
    return state.value
  } catch (err) {
    if (hardwareRuntimeStore.isTauriUnavailable(err)) {
      projectCanvasStore.applyAction(action)
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

async function start() {
  return startRuntime()
}

async function stop() {
  return stopRuntime()
}

async function configureDataStream(
  inputSignalOrder: readonly string[],
  outputSignalOrder: readonly string[],
  options?: {
    wordsPerCycle?: number
    vericommClockHighDelay?: number
    vericommClockLowDelay?: number
  },
) {
  return configureRuntimeDataStream(inputSignalOrder, outputSignalOrder, options)
}

async function setDataStreamRate(rateHz: number) {
  return setRuntimeDataStreamRate(rateHz)
}

async function refreshDataStreamStatus() {
  return refreshRuntimeDataStreamStatus()
}

async function startDataStream() {
  return startRuntimeDataStream()
}

async function stopDataStream() {
  return stopRuntimeDataStream()
}

async function disconnectView() {
  await disconnectRuntimeView()
}

export const hardwareStore = {
  state,
  canvasDevices,
  signalTelemetry: hardwareRuntimeStore.signalTelemetry,
  deviceTelemetry: hardwareRuntimeStore.deviceTelemetry,
  dataStreamStatus: hardwareRuntimeStore.dataStreamStatus,
  hotplugLog: hardwareRuntimeStore.hotplugLog,
  isStarted: hardwareRuntimeStore.isStarted,
  synthesisRunning: hardwareFlowStore.synthesisRunning,
  synthesisCancelling: hardwareFlowStore.synthesisCancelling,
  synthesisCancelled: hardwareFlowStore.synthesisCancelled,
  synthesisReport: hardwareFlowStore.synthesisReport,
  synthesisReportSignature: hardwareFlowStore.synthesisReportSignature,
  synthesisLiveLog: hardwareFlowStore.synthesisLiveLog,
  synthesisMessage: hardwareFlowStore.synthesisMessage,
  implementationRunning: hardwareFlowStore.implementationRunning,
  implementationCancelling: hardwareFlowStore.implementationCancelling,
  implementationCancelled: hardwareFlowStore.implementationCancelled,
  implementationReport: hardwareFlowStore.implementationReport,
  implementationReportSignature: hardwareFlowStore.implementationReportSignature,
  implementationLiveLog: hardwareFlowStore.implementationLiveLog,
  implementationMessage: hardwareFlowStore.implementationMessage,
  start,
  stop,
  configureDataStream,
  setDataStreamRate,
  refreshDataStreamStatus,
  startDataStream,
  stopDataStream,
  probe,
  dispatch,
  syncState,
  runSynthesis: hardwareFlowStore.runSynthesis,
  cancelSynthesis: hardwareFlowStore.cancelSynthesis,
  runImplementation: hardwareFlowStore.runImplementation,
  cancelImplementation: hardwareFlowStore.cancelImplementation,
  generateBitstream,
  programBitstream,
  upsertCanvasDevice,
  removeCanvasDevice,
  clearCanvasDevices,
  replaceCanvasDevices,
  setCanvasDevicePosition,
  bindCanvasSignal,
  bindCanvasSignalSlot,
  setCanvasSwitchState,
  clearError,
  disconnectView,
}
