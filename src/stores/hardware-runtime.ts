import type { UnlistenFn } from '@tauri-apps/api/event'

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { markRaw, ref } from 'vue'

import {
  type HardwareActionV1,
  type HardwareCanvasDeviceTelemetryEntryV1,
  type HardwareCanvasDeviceTelemetryV1,
  type HardwareDataBatchBinaryV1,
  type HardwareDataStreamConfigV1,
  type HardwareDataSignalCatalogV1,
  type HardwareDataStreamStatusV1,
  type HardwareEventV1,
  type HardwareStateV1,
  configureHardwareDataStream,
  hardwareDispatch,
  hardwareGetDataStreamStatus,
  hardwareGetState,
  listenHardwareDataBatchBinary,
  listenHardwareDataCatalog,
  listenHardwareDeviceSnapshot,
  listenHardwareStateChanged,
  setHardwareDataStreamRate,
  startHardwareDataStream,
  stopHardwareDataStream,
} from '@/lib/hardware-client'
import { translate } from '@/lib/i18n'

type HotplugPayload = {
  kind: 'arrived' | 'left'
}

type RuntimeState = Omit<HardwareStateV1, 'canvas_devices'>

type SignalTelemetrySnapshot = {
  latest: boolean
  high_ratio: number
  edge_count: number
  sequence: number
  updated_at_ms: number
}

type DeviceTelemetrySnapshot = HardwareCanvasDeviceTelemetryEntryV1 & {
  updated_at_ms: number
}

const DATA_DEFAULT_MIN_BATCH_CYCLES = 128
const DATA_DEFAULT_MAX_WAIT_US = 2000
const DATA_DEFAULT_CLOCK_HIGH_DELAY = 4
const DATA_DEFAULT_CLOCK_LOW_DELAY = 4

const initialRuntimeState: RuntimeState = {
  version: 1,
  phase: 'idle',
  device: null,
  artifact: null,
  last_error: null,
  op_id: null,
  updated_at_ms: 0,
}

const runtimeState = ref<RuntimeState>({ ...initialRuntimeState })
const hotplugLog = ref('')
const isStarted = ref(false)
const signalTelemetry = ref<Record<string, SignalTelemetrySnapshot>>({})
const deviceTelemetry = ref<Record<string, DeviceTelemetrySnapshot>>({})
const dataStreamStatus = ref<HardwareDataStreamStatusV1>({
  running: false,
  target_hz: 1,
  actual_hz: 0,
  transfer_rate_hz: 0,
  sequence: 0,
  dropped_samples: 0,
  queue_fill: 0,
  queue_capacity: 0,
  last_batch_at_ms: 0,
  last_batch_cycles: 0,
  words_per_cycle: 4,
  min_batch_cycles: DATA_DEFAULT_MIN_BATCH_CYCLES,
  max_wait_us: DATA_DEFAULT_MAX_WAIT_US,
  vericomm_clock_high_delay: DATA_DEFAULT_CLOCK_HIGH_DELAY,
  vericomm_clock_low_delay: DATA_DEFAULT_CLOCK_LOW_DELAY,
  configured_signal_count: 0,
  last_error: null,
})

let unlistenStateChanged: UnlistenFn | null = null
let unlistenHotplug: UnlistenFn | null = null
let unlistenDataBatch: UnlistenFn | null = null
let unlistenDataCatalog: UnlistenFn | null = null
let unlistenDeviceSnapshot: UnlistenFn | null = null
let telemetryRafId: number | null = null
let telemetryFlushTimerId: ReturnType<typeof setTimeout> | null = null

const pendingTelemetry = new Map<string, SignalTelemetrySnapshot>()
const pendingDeviceTelemetry = new Map<string, DeviceTelemetrySnapshot>()
const signalCatalog = new Map<number, string>()
let pendingDataBatchMeta: Pick<
  HardwareDataStreamStatusV1,
  | 'sequence'
  | 'dropped_samples'
  | 'queue_fill'
  | 'queue_capacity'
  | 'last_batch_at_ms'
  | 'last_batch_cycles'
> | null = null

const hardwareStateListeners = new Set<(state: HardwareStateV1) => void>()

function extractRuntimeState(nextState: HardwareStateV1): RuntimeState {
  const { canvas_devices: _canvasDevices, ...runtimeOnlyState } = nextState
  return runtimeOnlyState
}

function notifyHardwareState(nextState: HardwareStateV1) {
  for (const listener of hardwareStateListeners) {
    listener(nextState)
  }
}

function setRuntimeState(nextState: RuntimeState) {
  runtimeState.value = nextState
}

function applyHardwareState(nextState: HardwareStateV1) {
  setRuntimeState(extractRuntimeState(nextState))
  notifyHardwareState(nextState)
}

function setError(message: string) {
  runtimeState.value = {
    ...runtimeState.value,
    phase: 'error',
    last_error: message,
    updated_at_ms: Date.now(),
  }
}

function clearErrorLocal() {
  runtimeState.value = {
    ...runtimeState.value,
    last_error: null,
    phase:
      runtimeState.value.phase === 'error'
        ? runtimeState.value.device
          ? 'device_ready'
          : 'idle'
        : runtimeState.value.phase,
    updated_at_ms: Date.now(),
  }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function clearTelemetryFlushHandle() {
  if (telemetryRafId !== null) {
    if (typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(telemetryRafId)
    }
    telemetryRafId = null
  }
  if (telemetryFlushTimerId !== null) {
    clearTimeout(telemetryFlushTimerId)
    telemetryFlushTimerId = null
  }
}

function flushTelemetry() {
  if (pendingTelemetry.size > 0) {
    for (const [signal, value] of pendingTelemetry.entries()) {
      signalTelemetry.value[signal] = value
    }
    pendingTelemetry.clear()
  }

  if (pendingDeviceTelemetry.size > 0) {
    for (const [deviceId, value] of pendingDeviceTelemetry.entries()) {
      deviceTelemetry.value[deviceId] = value
    }
    pendingDeviceTelemetry.clear()
  }

  if (pendingDataBatchMeta) {
    dataStreamStatus.value.running = true
    dataStreamStatus.value.sequence = pendingDataBatchMeta.sequence
    dataStreamStatus.value.dropped_samples = pendingDataBatchMeta.dropped_samples
    dataStreamStatus.value.queue_fill = pendingDataBatchMeta.queue_fill
    dataStreamStatus.value.queue_capacity = pendingDataBatchMeta.queue_capacity
    dataStreamStatus.value.last_batch_at_ms = pendingDataBatchMeta.last_batch_at_ms
    dataStreamStatus.value.last_batch_cycles = pendingDataBatchMeta.last_batch_cycles
    pendingDataBatchMeta = null
  }

  clearTelemetryFlushHandle()
}

function scheduleTelemetryFlush() {
  if (telemetryRafId !== null || telemetryFlushTimerId !== null) {
    return
  }

  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    telemetryRafId = window.requestAnimationFrame(() => {
      flushTelemetry()
    })
    return
  }

  telemetryFlushTimerId = setTimeout(() => {
    flushTelemetry()
  }, 16)
}

function toSafeNumberFromU64(value: bigint): number {
  const maxSafe = BigInt(Number.MAX_SAFE_INTEGER)
  if (value > maxSafe) {
    return Number.MAX_SAFE_INTEGER
  }
  return Number(value)
}

function onDataCatalog(catalog: HardwareDataSignalCatalogV1) {
  for (const entry of catalog.entries) {
    signalCatalog.set(entry.signal_id, entry.signal)
  }
}

function onDeviceSnapshot(snapshot: HardwareCanvasDeviceTelemetryV1) {
  for (const device of snapshot.devices) {
    pendingDeviceTelemetry.set(
      device.device_id,
      markRaw({
        ...device,
        updated_at_ms: snapshot.generated_at_ms,
      }),
    )
  }

  scheduleTelemetryFlush()
}

function onDataBatchBinary(batch: HardwareDataBatchBinaryV1) {
  if (!dataStreamStatus.value.running) {
    return
  }

  const bytes = new Uint8Array(batch.payload)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const expectedHeaderBytes = 32
  if (view.byteLength < expectedHeaderBytes) {
    return
  }

  let offset = 0
  const sequence = toSafeNumberFromU64(view.getBigUint64(offset, true))
  offset += 8
  const generatedAtMs = toSafeNumberFromU64(view.getBigUint64(offset, true))
  offset += 8
  const droppedSamples = toSafeNumberFromU64(view.getBigUint64(offset, true))
  offset += 8
  const queueFill = view.getUint16(offset, true)
  offset += 2
  const queueCapacity = view.getUint16(offset, true)
  offset += 2
  const batchCycles = view.getUint16(offset, true)
  offset += 2
  const updateCount = view.getUint16(offset, true)
  offset += 2

  const bytesPerUpdate = 9
  const expectedBytes = expectedHeaderBytes + updateCount * bytesPerUpdate
  if (view.byteLength < expectedBytes) {
    return
  }

  for (let index = 0; index < updateCount; index += 1) {
    const signalId = view.getUint16(offset, true)
    offset += 2
    const latest = view.getUint8(offset) === 1
    offset += 1
    const highRatio = view.getFloat32(offset, true)
    offset += 4
    const edgeCount = view.getUint16(offset, true)
    offset += 2

    const signal = signalCatalog.get(signalId)
    if (!signal) {
      continue
    }

    pendingTelemetry.set(signal, {
      latest,
      high_ratio: highRatio,
      edge_count: edgeCount,
      sequence,
      updated_at_ms: generatedAtMs,
    })
  }

  pendingDataBatchMeta = {
    sequence,
    dropped_samples: droppedSamples,
    queue_fill: queueFill,
    queue_capacity: queueCapacity,
    last_batch_at_ms: generatedAtMs,
    last_batch_cycles: batchCycles,
  }

  scheduleTelemetryFlush()
}

function isTauriUnavailable(err: unknown): boolean {
  const message = getErrorMessage(err)
  return (
    message.includes('__TAURI_INTERNALS__') ||
    message.includes('window.__TAURI_INTERNALS__') ||
    message.includes('plugin') ||
    message.includes("Cannot read properties of undefined (reading 'invoke')") ||
    message.includes("Cannot read properties of undefined (reading 'transformCallback')")
  )
}

function isRuntimeOnlyAction(action: HardwareActionV1): boolean {
  return (
    action.type === 'probe' ||
    action.type === 'generate_bitstream' ||
    action.type === 'program_bitstream'
  )
}

function runtimeUnavailableMessage(action: HardwareActionV1): string {
  switch (action.type) {
    case 'probe':
      return 'Hardware probing is unavailable in browser mode. Run the desktop app to connect to FPGA hardware.'
    case 'generate_bitstream':
      return 'Bitstream generation is unavailable in browser mode. Run the desktop app to build FPGA bitstreams.'
    case 'program_bitstream':
      return 'Bitstream programming is unavailable in browser mode. Run the desktop app to program FPGA hardware.'
    default:
      return 'Hardware runtime actions are unavailable in browser mode. Run the desktop app for hardware access.'
  }
}

function resetRuntimeViewState() {
  hotplugLog.value = ''
  signalTelemetry.value = {}
  deviceTelemetry.value = {}
  clearTelemetryFlushHandle()
  pendingTelemetry.clear()
  pendingDeviceTelemetry.clear()
  signalCatalog.clear()
  pendingDataBatchMeta = null
  dataStreamStatus.value = {
    ...dataStreamStatus.value,
    running: false,
    actual_hz: 0,
    transfer_rate_hz: 0,
    queue_fill: 0,
    sequence: 0,
    dropped_samples: 0,
    last_batch_at_ms: 0,
    last_batch_cycles: 0,
    last_error: null,
  }
}

function applyDataStreamStatus(status: HardwareDataStreamStatusV1) {
  const targetHzChanged =
    Math.abs(status.target_hz - dataStreamStatus.value.target_hz) > Number.EPSILON

  if (!status.running || targetHzChanged) {
    pendingDataBatchMeta = null
  }

  if (!status.running) {
    signalTelemetry.value = {}
    deviceTelemetry.value = {}
    pendingTelemetry.clear()
    pendingDeviceTelemetry.clear()
  }

  dataStreamStatus.value = {
    ...status,
    last_error: status.last_error ?? null,
  }
}

function configuredSignalOrder(signalNames: readonly string[]) {
  return signalNames.map((signal) => signal.trim())
}

export async function syncState(): Promise<HardwareStateV1 | null> {
  try {
    const nextState = await hardwareGetState()
    applyHardwareState(nextState)
    return nextState
  } catch (err) {
    if (isTauriUnavailable(err)) {
      return null
    }
    throw err
  }
}

export async function refreshDataStreamStatus() {
  try {
    const status = await hardwareGetDataStreamStatus()
    applyDataStreamStatus(status)
    return status
  } catch (err) {
    if (isTauriUnavailable(err)) {
      return dataStreamStatus.value
    }
    throw err
  }
}

export async function dispatch(action: HardwareActionV1): Promise<HardwareStateV1 | null> {
  try {
    const nextState = await hardwareDispatch(action)
    applyHardwareState(nextState)
    return nextState
  } catch (err) {
    if (isTauriUnavailable(err)) {
      if (isRuntimeOnlyAction(action)) {
        setError(runtimeUnavailableMessage(action))
        return null
      }
      if (action.type === 'clear_error') {
        clearErrorLocal()
        return null
      }
    }
    throw err
  }
}

export async function start() {
  if (isStarted.value) {
    return
  }

  try {
    await syncState()

    try {
      await refreshDataStreamStatus()
    } catch (err) {
      if (!isTauriUnavailable(err)) {
        throw err
      }
    }

    unlistenStateChanged = await listenHardwareStateChanged((event: HardwareEventV1) => {
      applyHardwareState(event.state)
    })

    unlistenDataCatalog = await listenHardwareDataCatalog((catalog) => {
      onDataCatalog(catalog)
    })

    unlistenDataBatch = await listenHardwareDataBatchBinary((batch) => {
      onDataBatchBinary(batch)
    })

    unlistenDeviceSnapshot = await listenHardwareDeviceSnapshot((snapshot) => {
      onDeviceSnapshot(snapshot)
    })

    unlistenHotplug = await listen<HotplugPayload>('hardware:hotplug', (event) => {
      hotplugLog.value =
        event.payload.kind === 'arrived' ? translate('deviceConnected') : translate('deviceRemoved')
    })

    await invoke('start_hotplug_watch')
    isStarted.value = true
  } catch (err) {
    if (unlistenStateChanged) {
      unlistenStateChanged()
      unlistenStateChanged = null
    }
    if (unlistenDataBatch) {
      unlistenDataBatch()
      unlistenDataBatch = null
    }
    if (unlistenDataCatalog) {
      unlistenDataCatalog()
      unlistenDataCatalog = null
    }
    if (unlistenDeviceSnapshot) {
      unlistenDeviceSnapshot()
      unlistenDeviceSnapshot = null
    }
    if (unlistenHotplug) {
      unlistenHotplug()
      unlistenHotplug = null
    }
    resetRuntimeViewState()
    if (isTauriUnavailable(err)) {
      isStarted.value = false
      return
    }
    setError(err instanceof Error ? err.message : String(err))
    throw err
  }
}

export async function stop() {
  if (!isStarted.value) {
    return
  }

  try {
    if (dataStreamStatus.value.running) {
      await stopDataStream()
    }
    await invoke('stop_hotplug_watch')
  } finally {
    if (unlistenStateChanged) {
      unlistenStateChanged()
      unlistenStateChanged = null
    }
    if (unlistenDataBatch) {
      unlistenDataBatch()
      unlistenDataBatch = null
    }
    if (unlistenDataCatalog) {
      unlistenDataCatalog()
      unlistenDataCatalog = null
    }
    if (unlistenDeviceSnapshot) {
      unlistenDeviceSnapshot()
      unlistenDeviceSnapshot = null
    }
    if (unlistenHotplug) {
      unlistenHotplug()
      unlistenHotplug = null
    }
    resetRuntimeViewState()
    isStarted.value = false
  }
}

export async function configureDataStream(
  inputSignalOrder: readonly string[],
  outputSignalOrder: readonly string[],
  options?: {
    wordsPerCycle?: number
    vericommClockHighDelay?: number
    vericommClockLowDelay?: number
  },
) {
  const wordsPerCycle = options?.wordsPerCycle ?? dataStreamStatus.value.words_per_cycle ?? 4
  const nextConfig: HardwareDataStreamConfigV1 = {
    target_hz: dataStreamStatus.value.target_hz || 1,
    input_signal_order: configuredSignalOrder(inputSignalOrder),
    output_signal_order: configuredSignalOrder(outputSignalOrder),
    words_per_cycle: Math.max(1, Math.floor(wordsPerCycle)),
    min_batch_cycles: dataStreamStatus.value.min_batch_cycles || DATA_DEFAULT_MIN_BATCH_CYCLES,
    max_wait_us: dataStreamStatus.value.max_wait_us || DATA_DEFAULT_MAX_WAIT_US,
    vericomm_clock_high_delay:
      options?.vericommClockHighDelay ??
      dataStreamStatus.value.vericomm_clock_high_delay ??
      DATA_DEFAULT_CLOCK_HIGH_DELAY,
    vericomm_clock_low_delay:
      options?.vericommClockLowDelay ??
      dataStreamStatus.value.vericomm_clock_low_delay ??
      DATA_DEFAULT_CLOCK_LOW_DELAY,
  }

  try {
    const status = await configureHardwareDataStream(nextConfig)
    applyDataStreamStatus(status)
    return status
  } catch (err) {
    if (isTauriUnavailable(err)) {
      applyDataStreamStatus({
        ...dataStreamStatus.value,
        target_hz: nextConfig.target_hz,
        words_per_cycle: nextConfig.words_per_cycle,
        min_batch_cycles: nextConfig.min_batch_cycles,
        max_wait_us: nextConfig.max_wait_us,
        vericomm_clock_high_delay: nextConfig.vericomm_clock_high_delay,
        vericomm_clock_low_delay: nextConfig.vericomm_clock_low_delay,
        configured_signal_count:
          nextConfig.input_signal_order.filter(Boolean).length +
          nextConfig.output_signal_order.filter(Boolean).length,
        last_error: null,
      })
      return dataStreamStatus.value
    }
    throw err
  }
}

export async function setDataStreamRate(rateHz: number) {
  try {
    const status = await setHardwareDataStreamRate(rateHz)
    applyDataStreamStatus(status)
    return status
  } catch (err) {
    if (isTauriUnavailable(err)) {
      applyDataStreamStatus({
        ...dataStreamStatus.value,
        target_hz: rateHz,
        last_error: null,
      })
      return dataStreamStatus.value
    }
    throw err
  }
}

export async function startDataStream() {
  try {
    await startHardwareDataStream()
    await refreshDataStreamStatus()
  } catch (err) {
    if (isTauriUnavailable(err)) {
      applyDataStreamStatus({
        ...dataStreamStatus.value,
        running: true,
        last_error: null,
      })
      return
    }
    throw err
  }
}

export async function stopDataStream() {
  try {
    await stopHardwareDataStream()
  } catch (err) {
    if (!isTauriUnavailable(err)) {
      throw err
    }
  }

  clearTelemetryFlushHandle()
  signalTelemetry.value = {}
  deviceTelemetry.value = {}
  pendingTelemetry.clear()
  pendingDeviceTelemetry.clear()
  pendingDataBatchMeta = null

  applyDataStreamStatus({
    ...dataStreamStatus.value,
    running: false,
    actual_hz: 0,
    transfer_rate_hz: 0,
    queue_fill: 0,
    last_batch_cycles: 0,
    last_error: null,
  })
}

export async function disconnectView() {
  await stop()
  runtimeState.value = { ...initialRuntimeState }
  resetRuntimeViewState()
}

function subscribeHardwareState(listener: (state: HardwareStateV1) => void) {
  hardwareStateListeners.add(listener)

  return () => {
    hardwareStateListeners.delete(listener)
  }
}

export const hardwareRuntimeStore = {
  runtimeState,
  signalTelemetry,
  deviceTelemetry,
  dataStreamStatus,
  hotplugLog,
  isStarted,
  dispatch,
  syncState,
  start,
  stop,
  refreshDataStreamStatus,
  configureDataStream,
  setDataStreamRate,
  startDataStream,
  stopDataStream,
  disconnectView,
  subscribeHardwareState,
  isTauriUnavailable,
}
