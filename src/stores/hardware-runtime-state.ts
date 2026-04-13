import type {
  HardwareCanvasDeviceTelemetryEntry,
  HardwareDataStreamStatusV1,
  HardwareStateV1,
} from '@/lib/hardware-client'

import { ref } from 'vue'

export type HotplugPayload = {
  kind: 'arrived' | 'left'
}

export type RuntimeState = Omit<HardwareStateV1, 'canvas_devices'>

export type SignalTelemetrySnapshot = {
  latest: boolean
  high_ratio: number
  edge_count: number
  sequence: number
  updated_at_ms: number
}

export type DeviceTelemetrySnapshot = HardwareCanvasDeviceTelemetryEntry

export const DATA_DEFAULT_MIN_BATCH_CYCLES = 128
export const DATA_DEFAULT_MAX_WAIT_US = 2000
export const DATA_DEFAULT_CLOCK_HIGH_DELAY = 4
export const DATA_DEFAULT_CLOCK_LOW_DELAY = 4

export const initialRuntimeState: RuntimeState = {
  version: 1,
  phase: 'idle',
  device: null,
  artifact: null,
  last_error: null,
  op_id: null,
  updated_at_ms: 0,
}

function createInitialDataStreamStatus(): HardwareDataStreamStatusV1 {
  return {
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
  }
}

export const runtimeState = ref<RuntimeState>({ ...initialRuntimeState })
export const hotplugLog = ref('')
export const isStarted = ref(false)
export const signalTelemetry = ref<Record<string, SignalTelemetrySnapshot>>({})
export const deviceTelemetry = ref<Record<string, DeviceTelemetrySnapshot>>({})
export const dataStreamStatus = ref<HardwareDataStreamStatusV1>(createInitialDataStreamStatus())

export function extractRuntimeState(nextState: HardwareStateV1): RuntimeState {
  const { canvas_devices: _canvasDevices, ...runtimeOnlyState } = nextState
  return runtimeOnlyState
}

export function setRuntimeState(nextState: RuntimeState) {
  runtimeState.value = nextState
}

export function applyHardwareState(nextState: HardwareStateV1) {
  setRuntimeState(extractRuntimeState(nextState))
}

export function setError(message: string) {
  runtimeState.value = {
    ...runtimeState.value,
    phase: 'error',
    last_error: message,
    updated_at_ms: Date.now(),
  }
}

export function clearErrorLocal() {
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

export function resetRuntimeState() {
  runtimeState.value = { ...initialRuntimeState }
}
