import type {
  HardwareCanvasDeviceTelemetry,
  HardwareDataBatchBinaryV1,
  HardwareDataSignalCatalogV1,
  HardwareDataStreamStatusV1,
} from '@/lib/hardware-client'

import { markRaw } from 'vue'

import {
  dataStreamStatus,
  deviceTelemetry,
  hotplugLog,
  type DeviceTelemetrySnapshot,
  signalTelemetry,
  type SignalTelemetrySnapshot,
} from './hardware-runtime-state'

let telemetryRafId: number | null = null
let telemetryFlushTimerId: ReturnType<typeof setTimeout> | null = null

const pendingTelemetry = new Map<string, SignalTelemetrySnapshot>()
const pendingDeviceTelemetry = new Map<string, DeviceTelemetrySnapshot>()
const signalCatalog = new Map<number, string>()
let pendingDataBatchMeta: Pick<
  HardwareDataStreamStatusV1,
  | 'sequence'
  | 'dropped_samples'
  | 'actual_hz'
  | 'transfer_rate_hz'
  | 'queue_fill'
  | 'queue_capacity'
  | 'last_batch_at_ms'
  | 'last_batch_cycles'
> | null = null

function clearTelemetryState() {
  signalTelemetry.value = {}
  deviceTelemetry.value = {}
  pendingTelemetry.clear()
  pendingDeviceTelemetry.clear()
}

export function clearTelemetryFlushHandle() {
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
    dataStreamStatus.value.actual_hz = pendingDataBatchMeta.actual_hz
    dataStreamStatus.value.transfer_rate_hz = pendingDataBatchMeta.transfer_rate_hz
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

export function onDataCatalog(catalog: HardwareDataSignalCatalogV1) {
  for (const entry of catalog.entries) {
    signalCatalog.set(entry.signal_id, entry.signal)
  }
}

export function onDeviceSnapshot(snapshot: HardwareCanvasDeviceTelemetry) {
  for (const device of snapshot.devices) {
    pendingDeviceTelemetry.set(device.device_id, markRaw(device))
  }

  scheduleTelemetryFlush()
}

export function onDataBatchBinary(batch: HardwareDataBatchBinaryV1) {
  if (!dataStreamStatus.value.running) {
    return
  }

  const bytes = new Uint8Array(batch.payload)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const expectedHeaderBytesLegacy = 32
  const expectedHeaderBytesCurrent = 48
  if (view.byteLength < expectedHeaderBytesLegacy) {
    return
  }
  if (batch.version >= 2 && view.byteLength < expectedHeaderBytesCurrent) {
    return
  }

  let offset = 0
  const sequence = toSafeNumberFromU64(view.getBigUint64(offset, true))
  offset += 8
  const generatedAtMs = toSafeNumberFromU64(view.getBigUint64(offset, true))
  offset += 8
  const droppedSamples = toSafeNumberFromU64(view.getBigUint64(offset, true))
  offset += 8
  const hasRateHeader = batch.version >= 2 && view.byteLength >= expectedHeaderBytesCurrent
  const actualHz = hasRateHeader ? view.getFloat64(offset, true) : dataStreamStatus.value.actual_hz
  if (hasRateHeader) {
    offset += 8
  }
  const transferRateHz = hasRateHeader
    ? view.getFloat64(offset, true)
    : dataStreamStatus.value.transfer_rate_hz
  if (hasRateHeader) {
    offset += 8
  }
  const queueFill = view.getUint16(offset, true)
  offset += 2
  const queueCapacity = view.getUint16(offset, true)
  offset += 2
  const batchCycles = view.getUint16(offset, true)
  offset += 2
  const updateCount = view.getUint16(offset, true)
  offset += 2

  const bytesPerUpdate = 9
  const expectedHeaderBytes = hasRateHeader ? expectedHeaderBytesCurrent : expectedHeaderBytesLegacy
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
    actual_hz: actualHz,
    transfer_rate_hz: transferRateHz,
    queue_fill: queueFill,
    queue_capacity: queueCapacity,
    last_batch_at_ms: generatedAtMs,
    last_batch_cycles: batchCycles,
  }

  scheduleTelemetryFlush()
}

export function resetRuntimeViewState() {
  hotplugLog.value = ''
  clearTelemetryState()
  clearTelemetryFlushHandle()
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

export function applyDataStreamStatus(status: HardwareDataStreamStatusV1) {
  const targetHzChanged =
    Math.abs(status.target_hz - dataStreamStatus.value.target_hz) > Number.EPSILON

  if (!status.running || targetHzChanged) {
    pendingDataBatchMeta = null
  }

  if (!status.running) {
    clearTelemetryState()
  }

  dataStreamStatus.value = {
    ...status,
    last_error: status.last_error ?? null,
  }
}

export function configuredSignalOrder(signalNames: readonly string[]) {
  return signalNames.map((signal) => signal.trim())
}

export function clearStoppedDataStreamTelemetry() {
  clearTelemetryFlushHandle()
  clearTelemetryState()
  pendingDataBatchMeta = null
}
