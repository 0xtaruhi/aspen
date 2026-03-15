import type {
  CanvasDeviceSnapshot,
  HardwareActionV1,
  ImplementationLogChunkV1,
  ImplementationReportV1,
  ImplementationRequestV1,
  HardwareStateV1,
  SynthesisReportV1,
  SynthesisLogChunkV1,
  SynthesisRequestV1,
} from '@/lib/hardware-client'

import { computed, readonly, ref, watch } from 'vue'

import { saveProjectToCurrentPath } from '@/lib/project-io'
import { translate } from '@/lib/i18n'
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
import {
  listenHardwareImplementationLog,
  listenHardwareSynthesisLog,
  runHardwareImplementation,
  runHardwareSynthesis,
} from '@/lib/hardware-client'
import { appendSynthesisLogChunk } from '../lib/synthesis-log'
import { buildImplementationInputSignature } from '../lib/implementation-request-signature'
import { buildSynthesisInputSignature } from '../lib/synthesis-request-signature'
import { projectStore, type ProjectSynthesisCacheSnapshot } from './project'
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

async function runSynthesis(request: SynthesisRequestV1): Promise<SynthesisReportV1> {
  await ensureSynthesisLogListener()
  synthesisRunning.value = true
  synthesisMessage.value = ''
  synthesisLiveLog.value = ''
  synthesisLogBuffer = ''
  flushSynthesisLogBuffer()
  synthesisOperationId.value = request.op_id
  const requestSignature = buildSynthesisInputSignature(request.top_module, request.files)
  try {
    const report = await runHardwareSynthesis(request)
    applyPersistedSynthesisState({
      version: 1,
      signature: requestSignature,
      report,
    })
    projectStore.setSynthesisCache({
      version: 1,
      signature: requestSignature,
      report,
    })
    try {
      await saveProjectToCurrentPath({ silent: true })
    } catch (err) {
      synthesisMessage.value = translate('autoSaveProjectFailed', {
        message: getErrorMessage(err),
      })
    }
    return report
  } catch (err) {
    synthesisMessage.value = getErrorMessage(err)
    throw err
  } finally {
    flushSynthesisLogBuffer()
    synthesisRunning.value = false
    synthesisOperationId.value = null
  }
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

async function configureDataStream(signalNames: readonly string[], wordsPerCycle?: number) {
  return configureRuntimeDataStream(signalNames, wordsPerCycle)
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
  virtualDeviceStore.resetState()
}

const synthesisRunning = ref(false)
const synthesisReport = ref<SynthesisReportV1 | null>(null)
const synthesisReportSignature = ref<string | null>(null)
const synthesisLiveLog = ref('')
const synthesisMessage = ref('')
const synthesisOperationId = ref<string | null>(null)
const implementationRunning = ref(false)
const implementationReport = ref<ImplementationReportV1 | null>(null)
const implementationReportSignature = ref<string | null>(null)
const implementationLiveLog = ref('')
const implementationMessage = ref('')
const implementationOperationId = ref<string | null>(null)
let synthesisLogBuffer = ''
let synthesisLogFlushTimer: ReturnType<typeof setTimeout> | null = null
let implementationLogBuffer = ''
let implementationLogFlushTimer: ReturnType<typeof setTimeout> | null = null
let unlistenSynthesisLog: (() => void) | null = null
let synthesisLogListenerPromise: Promise<void> | null = null
let unlistenImplementationLog: (() => void) | null = null
let implementationLogListenerPromise: Promise<void> | null = null

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function onSynthesisLogChunk(chunk: SynthesisLogChunkV1) {
  const appended = appendSynthesisLogChunk('', synthesisOperationId.value, chunk)
  if (!appended) {
    return
  }

  synthesisLogBuffer += appended
  scheduleSynthesisLogFlush()
}

function scheduleSynthesisLogFlush() {
  if (synthesisLogFlushTimer) {
    return
  }

  synthesisLogFlushTimer = setTimeout(() => {
    flushSynthesisLogBuffer()
  }, 50)
}

function flushSynthesisLogBuffer() {
  if (synthesisLogFlushTimer) {
    clearTimeout(synthesisLogFlushTimer)
    synthesisLogFlushTimer = null
  }

  if (!synthesisLogBuffer) {
    return
  }

  synthesisLiveLog.value += synthesisLogBuffer
  synthesisLogBuffer = ''
}

function onImplementationLogChunk(chunk: ImplementationLogChunkV1) {
  if (implementationOperationId.value !== chunk.op_id) {
    return
  }

  if (chunk.stage === 'yosys') {
    return
  }

  const stagePrefix = `[${chunk.stage}] `
  implementationLogBuffer += chunk.chunk
    .split(/\r?\n/)
    .filter((line, index, lines) => {
      return line.length > 0 || index < lines.length - 1
    })
    .map((line) => `${stagePrefix}${line}`)
    .join('\n')

  if (!implementationLogBuffer.endsWith('\n')) {
    implementationLogBuffer += '\n'
  }

  scheduleImplementationLogFlush()
}

function scheduleImplementationLogFlush() {
  if (implementationLogFlushTimer) {
    return
  }

  implementationLogFlushTimer = setTimeout(() => {
    flushImplementationLogBuffer()
  }, 50)
}

function flushImplementationLogBuffer() {
  if (implementationLogFlushTimer) {
    clearTimeout(implementationLogFlushTimer)
    implementationLogFlushTimer = null
  }

  if (!implementationLogBuffer) {
    return
  }

  implementationLiveLog.value += implementationLogBuffer
  implementationLogBuffer = ''
}

function applyPersistedSynthesisState(snapshot: ProjectSynthesisCacheSnapshot | null) {
  flushSynthesisLogBuffer()
  synthesisRunning.value = false
  synthesisOperationId.value = null
  synthesisMessage.value = ''
  synthesisLiveLog.value = ''
  synthesisLogBuffer = ''
  synthesisReport.value = snapshot?.report ?? null
  synthesisReportSignature.value = snapshot?.signature ?? null
}

async function ensureSynthesisLogListener() {
  if (unlistenSynthesisLog) {
    return
  }

  if (synthesisLogListenerPromise) {
    await synthesisLogListenerPromise
    return
  }

  synthesisLogListenerPromise = listenHardwareSynthesisLog(onSynthesisLogChunk)
    .then((unlisten) => {
      unlistenSynthesisLog = unlisten
    })
    .catch((err) => {
      if (!hardwareRuntimeStore.isTauriUnavailable(err)) {
        throw err
      }
    })
    .finally(() => {
      synthesisLogListenerPromise = null
    })

  await synthesisLogListenerPromise
}

async function ensureImplementationLogListener() {
  if (unlistenImplementationLog) {
    return
  }

  if (implementationLogListenerPromise) {
    await implementationLogListenerPromise
    return
  }

  implementationLogListenerPromise = listenHardwareImplementationLog(onImplementationLogChunk)
    .then((unlisten) => {
      unlistenImplementationLog = unlisten
    })
    .catch((err) => {
      if (!hardwareRuntimeStore.isTauriUnavailable(err)) {
        throw err
      }
    })
    .finally(() => {
      implementationLogListenerPromise = null
    })

  await implementationLogListenerPromise
}

async function runImplementation(
  request: ImplementationRequestV1,
): Promise<ImplementationReportV1> {
  await ensureImplementationLogListener()
  implementationRunning.value = true
  implementationMessage.value = ''
  implementationLiveLog.value = ''
  implementationLogBuffer = ''
  flushImplementationLogBuffer()
  implementationOperationId.value = request.op_id
  implementationReportSignature.value = buildImplementationInputSignature(
    request.top_module,
    request.target_device_id,
    request.constraint_xml,
    request.place_mode,
    request.route_mode,
    request.files,
  )

  try {
    const report = await runHardwareImplementation(request)
    flushImplementationLogBuffer()
    implementationReport.value = report
    return report
  } catch (err) {
    flushImplementationLogBuffer()
    implementationMessage.value = getErrorMessage(err)
    throw err
  } finally {
    flushImplementationLogBuffer()
    implementationRunning.value = false
    implementationOperationId.value = null
  }
}

function resetImplementationState() {
  flushImplementationLogBuffer()
  implementationRunning.value = false
  implementationReport.value = null
  implementationReportSignature.value = null
  implementationLiveLog.value = ''
  implementationMessage.value = ''
  implementationOperationId.value = null
  implementationLogBuffer = ''
}

function resetSynthesisState() {
  applyPersistedSynthesisState(null)
  projectStore.setSynthesisCache(null)
}

watch(
  () => projectStore.synthesisCache,
  (snapshot) => {
    applyPersistedSynthesisState(snapshot)
  },
  { immediate: true },
)

export const hardwareStore = {
  state,
  signalTelemetry: hardwareRuntimeStore.signalTelemetry,
  deviceTelemetry: hardwareRuntimeStore.deviceTelemetry,
  dataStreamStatus: hardwareRuntimeStore.dataStreamStatus,
  hotplugLog: hardwareRuntimeStore.hotplugLog,
  isStarted: hardwareRuntimeStore.isStarted,
  synthesisRunning: readonly(synthesisRunning),
  synthesisReport: readonly(synthesisReport),
  synthesisReportSignature: readonly(synthesisReportSignature),
  synthesisLiveLog: readonly(synthesisLiveLog),
  synthesisMessage: readonly(synthesisMessage),
  implementationRunning: readonly(implementationRunning),
  implementationReport: readonly(implementationReport),
  implementationReportSignature: readonly(implementationReportSignature),
  implementationLiveLog: readonly(implementationLiveLog),
  implementationMessage: readonly(implementationMessage),
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
  runSynthesis,
  runImplementation,
  generateBitstream,
  programBitstream,
  upsertCanvasDevice,
  removeCanvasDevice,
  clearCanvasDevices,
  setCanvasDevicePosition,
  bindCanvasSignal,
  bindCanvasSignalSlot,
  setCanvasSwitchState,
  clearError,
  disconnectView,
  resetSynthesisState,
  resetImplementationState,
}
