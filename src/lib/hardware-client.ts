import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type HardwarePhase =
  | 'idle'
  | 'probing'
  | 'device_ready'
  | 'generating'
  | 'bitstream_ready'
  | 'programming'
  | 'programmed'
  | 'device_disconnected'
  | 'error'

export interface HardwareConfigSnapshot {
  smims_version: string
  fifo_words: number
  flash_total_block: number
  flash_block_size: number
  flash_cluster_size: number
  vericomm_enabled: boolean
  programmed: boolean
  pcb_connected: boolean
}

export interface HardwareDeviceSnapshot {
  board: string
  description: string
  config: HardwareConfigSnapshot
}

export interface HardwareArtifactSnapshot {
  path: string
  bytes: number
}

export interface SynthesisSourceFileV1 {
  path: string
  content: string
}

export interface SynthesisRequestV1 {
  op_id: string
  top_module: string
  files: SynthesisSourceFileV1[]
}

export interface SynthesisLogChunkV1 {
  version: 1
  op_id: string
  chunk: string
  generated_at_ms: number
}

export interface SynthesisCellTypeCountV1 {
  cell_type: string
  count: number
}

export interface SynthesisStatsV1 {
  wire_count: number
  wire_bits: number
  public_wire_count: number
  public_wire_bits: number
  memory_count: number
  memory_bits: number
  cell_count: number
  sequential_cell_count: number
  cell_type_counts: SynthesisCellTypeCountV1[]
}

export interface SynthesisReportV1 {
  version: 1
  op_id: string
  success: boolean
  top_module: string
  source_count: number
  tool_path: string
  elapsed_ms: number
  warnings: number
  errors: number
  log: string
  stats: SynthesisStatsV1
  generated_at_ms: number
}

export type CanvasDeviceType =
  | 'led'
  | 'switch'
  | 'button'
  | 'keypad'
  | 'small_keypad'
  | 'rotary_button'
  | 'ps2_keyboard'
  | 'text_lcd'
  | 'graphic_lcd'
  | 'segment_display'
  | 'led_matrix'

export type CanvasDeviceBindingSnapshot =
  | {
      kind: 'single'
      signal: string | null
    }
  | {
      kind: 'slots'
      signals: Array<string | null>
    }

export type CanvasDeviceConfigSnapshot =
  | {
      kind: 'none'
    }
  | {
      kind: 'segment_display'
      digits: number
    }
  | {
      kind: 'led_matrix'
      rows: number
      columns: number
    }

export interface CanvasDeviceStateSnapshot {
  is_on: boolean
  color: string | null
  binding: CanvasDeviceBindingSnapshot
  config: CanvasDeviceConfigSnapshot
}

export interface CanvasDeviceSnapshot {
  id: string
  type: CanvasDeviceType
  x: number
  y: number
  label: string
  state: CanvasDeviceStateSnapshot
}

export interface HardwareStateV1 {
  version: 1
  phase: HardwarePhase
  device: HardwareDeviceSnapshot | null
  artifact: HardwareArtifactSnapshot | null
  canvas_devices: CanvasDeviceSnapshot[]
  last_error: string | null
  op_id: string | null
  updated_at_ms: number
}

export type HardwareEventReason = 'action' | 'hotplug' | 'startup' | 'recovery'

export interface HardwareEventV1 {
  version: 1
  state: HardwareStateV1
  reason: HardwareEventReason
}

export interface HardwareSignalAggregateV1 {
  signal: string
  latest: boolean
  high_ratio: number
  edge_count: number
}

export interface HardwareDataBatchV1 {
  version: 1
  sequence: number
  generated_at_ms: number
  dropped_samples: number
  queue_fill: number
  queue_capacity: number
  updates: HardwareSignalAggregateV1[]
}

export interface HardwareDataBatchBinaryV1 {
  version: 1
  payload: number[]
}

export interface HardwareDataSignalCatalogEntryV1 {
  signal_id: number
  signal: string
}

export interface HardwareDataSignalCatalogV1 {
  version: 1
  generated_at_ms: number
  entries: HardwareDataSignalCatalogEntryV1[]
}

export interface HardwareCanvasDeviceTelemetryEntryV1 {
  device_id: string
  latest: boolean
  high_ratio: number
  segment_mask: number | null
  digit_segment_masks: number[]
  pixel_columns: number
  pixel_rows: number
  pixels: number[]
}

export interface HardwareCanvasDeviceTelemetryV1 {
  version: 1
  generated_at_ms: number
  devices: HardwareCanvasDeviceTelemetryEntryV1[]
}

export interface HardwareDataStreamConfigV1 {
  target_hz: number
  signal_order: string[]
  words_per_cycle: number
  min_batch_cycles: number
  max_wait_us: number
}

export interface HardwareDataStreamStatusV1 {
  running: boolean
  target_hz: number
  actual_hz: number
  transfer_rate_hz: number
  sequence: number
  dropped_samples: number
  queue_fill: number
  queue_capacity: number
  last_batch_at_ms: number
  last_batch_cycles: number
  words_per_cycle: number
  min_batch_cycles: number
  max_wait_us: number
  configured_signal_count: number
  last_error: string | null
}

export type HardwareActionV1 =
  | { type: 'probe' }
  | {
      type: 'generate_bitstream'
      source_name: string
      source_code: string
      output_path?: string | null
    }
  | {
      type: 'program_bitstream'
      bitstream_path?: string | null
    }
  | {
      type: 'upsert_canvas_device'
      device: CanvasDeviceSnapshot
    }
  | {
      type: 'remove_canvas_device'
      id: string
    }
  | {
      type: 'set_canvas_device_position'
      id: string
      x: number
      y: number
    }
  | {
      type: 'bind_canvas_signal'
      id: string
      signal_name?: string | null
    }
  | {
      type: 'bind_canvas_signal_slot'
      id: string
      slot_index: number
      signal_name?: string | null
    }
  | {
      type: 'set_canvas_switch_state'
      id: string
      is_on: boolean
    }
  | { type: 'clear_error' }

export async function hardwareGetState(): Promise<HardwareStateV1> {
  return invoke<HardwareStateV1>('hardware_get_state')
}

export async function hardwareDispatch(action: HardwareActionV1): Promise<HardwareStateV1> {
  return invoke<HardwareStateV1>('hardware_dispatch', { action })
}

export async function runHardwareSynthesis(
  request: SynthesisRequestV1,
): Promise<SynthesisReportV1> {
  return invoke<SynthesisReportV1>('run_yosys_synthesis', { request })
}

export async function listenHardwareSynthesisLog(
  callback: (chunk: SynthesisLogChunkV1) => void,
): Promise<UnlistenFn> {
  return listen<SynthesisLogChunkV1>('hardware:synthesis_log', (event) => {
    callback(event.payload)
  })
}

export async function hardwareGetDataStreamStatus(): Promise<HardwareDataStreamStatusV1> {
  return invoke<HardwareDataStreamStatusV1>('hardware_get_data_stream_status')
}

export async function configureHardwareDataStream(
  config: HardwareDataStreamConfigV1,
): Promise<HardwareDataStreamStatusV1> {
  return invoke<HardwareDataStreamStatusV1>('configure_hardware_data_stream', { config })
}

export async function setHardwareDataStreamRate(
  rateHz: number,
): Promise<HardwareDataStreamStatusV1> {
  return invoke<HardwareDataStreamStatusV1>('set_hardware_data_stream_rate', {
    rateHz,
  })
}

export async function startHardwareDataStream(): Promise<void> {
  await invoke('start_hardware_data_stream')
}

export async function stopHardwareDataStream(): Promise<void> {
  await invoke('stop_hardware_data_stream')
}

export async function listenHardwareStateChanged(
  callback: (event: HardwareEventV1) => void,
): Promise<UnlistenFn> {
  return listen<HardwareEventV1>('hardware:state_changed', (event) => {
    callback(event.payload)
  })
}

export async function listenHardwareDataBatch(
  callback: (batch: HardwareDataBatchV1) => void,
): Promise<UnlistenFn> {
  return listen<HardwareDataBatchV1>('hardware:data_batch', (event) => {
    callback(event.payload)
  })
}

export async function listenHardwareDataBatchBinary(
  callback: (batch: HardwareDataBatchBinaryV1) => void,
): Promise<UnlistenFn> {
  return listen<HardwareDataBatchBinaryV1>('hardware:data_batch_bin', (event) => {
    callback(event.payload)
  })
}

export async function listenHardwareDataCatalog(
  callback: (catalog: HardwareDataSignalCatalogV1) => void,
): Promise<UnlistenFn> {
  return listen<HardwareDataSignalCatalogV1>('hardware:data_catalog', (event) => {
    callback(event.payload)
  })
}

export async function listenHardwareDeviceSnapshot(
  callback: (snapshot: HardwareCanvasDeviceTelemetryV1) => void,
): Promise<UnlistenFn> {
  return listen<HardwareCanvasDeviceTelemetryV1>('hardware:device_snapshot', (event) => {
    callback(event.payload)
  })
}
