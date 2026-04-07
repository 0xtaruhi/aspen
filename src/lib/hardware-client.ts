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

export interface LoadedMemoryImage {
  format: 'text' | 'binary'
  words: number[]
  source_path: string
}

export interface SynthesisSourceFileV1 {
  path: string
  content: string
}

export interface SynthesisRequestV1 {
  op_id: string
  project_name?: string | null
  project_dir?: string | null
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

export interface SynthesisTopPortV1 {
  name: string
  direction: 'input' | 'output' | 'inout'
  width: string
}

export interface SynthesisArtifactsV1 {
  work_dir: string
  script_path: string | null
  netlist_json_path: string | null
  edif_path: string | null
  flow_revision?: string | null
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
  top_ports: SynthesisTopPortV1[]
  artifacts?: SynthesisArtifactsV1 | null
  generated_at_ms: number
}

export type ImplementationStageKindV1 =
  | 'yosys'
  | 'map'
  | 'pack'
  | 'place'
  | 'route'
  | 'sta'
  | 'bitgen'

export type ImplementationPlaceModeV1 = 'timing_driven' | 'bounding_box'

export interface ImplementationRequestV1 {
  op_id: string
  project_name: string
  project_dir: string | null
  top_module: string
  target_device_id: string
  constraint_xml: string
  place_mode: ImplementationPlaceModeV1
  synthesized_edif_path?: string | null
  files: SynthesisSourceFileV1[]
}

export interface ImplementationLogChunkV1 {
  version: 1
  op_id: string
  stage: ImplementationStageKindV1
  chunk: string
  generated_at_ms: number
}

export interface ImplementationArtifactsV1 {
  work_dir: string
  constraint_path: string
  edif_path: string | null
  map_path: string | null
  pack_path: string | null
  place_path: string | null
  route_path: string | null
  sta_output_path: string | null
  sta_report_path: string | null
  bitstream_path: string | null
}

export interface ImplementationStageResultV1 {
  stage: ImplementationStageKindV1
  success: boolean
  optional: boolean
  elapsed_ms: number
  warning_count: number
  error_count: number
  exit_code: number | null
  log_path: string | null
  output_path: string | null
  error_message: string | null
}

export interface ImplementationReportV1 {
  version: 1
  op_id: string
  success: boolean
  timing_success: boolean
  top_module: string
  source_count: number
  elapsed_ms: number
  log: string
  stages: ImplementationStageResultV1[]
  artifacts: ImplementationArtifactsV1
  timing_report: string
  generated_at_ms: number
}

export const CANVAS_DEVICE_TYPES = [
  'led',
  'switch',
  'button',
  'dip_switch_bank',
  'led_bar',
  'audio_pwm',
  'quadrature_encoder',
  'matrix_keypad',
  'uart_terminal',
  'hd44780_lcd',
  'memory',
  'vga_display',
  'segment_display',
  'led_matrix',
] as const

export type CanvasDeviceType = (typeof CANVAS_DEVICE_TYPES)[number]

export type CanvasVgaColorMode = 'mono' | 'rgb111' | 'rgb332' | 'rgb444' | 'rgb565' | 'rgb888'
export type CanvasHd44780BusMode = '4bit' | '8bit'
export type CanvasUartMode = 'tx' | 'rx' | 'tx_rx'
export type CanvasMemoryMode = 'rom' | 'ram'

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
      kind: 'button'
      active_low?: boolean
    }
  | {
      kind: 'segment_display'
      digits: number
      active_low?: boolean
    }
  | {
      kind: 'led_matrix'
      rows: number
      columns: number
    }
  | {
      kind: 'vga_display'
      columns: number
      rows: number
      color_mode: CanvasVgaColorMode
    }
  | {
      kind: 'dip_switch_bank'
      width: number
    }
  | {
      kind: 'led_bar'
      width: number
      active_low?: boolean
    }
  | {
      kind: 'quadrature_encoder'
      has_button?: boolean
    }
  | {
      kind: 'matrix_keypad'
      rows: number
      columns: number
      active_low?: boolean
    }
  | {
      kind: 'uart_terminal'
      cycles_per_bit: number
      mode: CanvasUartMode
    }
  | {
      kind: 'hd44780_lcd'
      columns: number
      rows: number
      bus_mode: CanvasHd44780BusMode
    }
  | {
      kind: 'memory'
      mode: CanvasMemoryMode
      address_width: number
      data_width: number
    }

export type CanvasDeviceDataSnapshot =
  | {
      kind: 'none'
    }
  | {
      kind: 'bitset'
      bits: boolean[]
    }
  | {
      kind: 'quadrature_encoder'
      phase: number
      button_pressed: boolean
    }
  | {
      kind: 'matrix_keypad'
      pressed_row: number | null
      pressed_column: number | null
    }
  | {
      kind: 'queued_bytes'
      bytes: number[]
    }
  | {
      kind: 'memory'
      words: number[]
      source_path: string | null
      preview_offset: number
    }

export interface CanvasDeviceStateSnapshot {
  is_on: boolean
  color: string | null
  binding: CanvasDeviceBindingSnapshot
  config: CanvasDeviceConfigSnapshot
  data: CanvasDeviceDataSnapshot
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
  bit_values: number[]
  text_lines: string[]
  text_log: string
  memory_words: number[]
  sample_values: number[]
  audio_edge_count: number
  audio_sample_count: number
  audio_period_samples: number
  memory_word_count: number
  memory_preview_start: number
  memory_address: number
  memory_output_word: number
}

export interface HardwareCanvasDeviceTelemetryV1 {
  version: 1
  generated_at_ms: number
  devices: HardwareCanvasDeviceTelemetryEntryV1[]
}

export interface HardwareDataStreamConfigV1 {
  target_hz: number
  input_signal_order: string[]
  output_signal_order: string[]
  words_per_cycle: number
  min_batch_cycles: number
  max_wait_us: number
  vericomm_clock_high_delay: number
  vericomm_clock_low_delay: number
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
  vericomm_clock_high_delay: number
  vericomm_clock_low_delay: number
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
      type: 'clear_canvas_devices'
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

export async function runHardwareImplementation(
  request: ImplementationRequestV1,
): Promise<ImplementationReportV1> {
  return invoke<ImplementationReportV1>('run_fde_implementation', { request })
}

export async function loadHardwareMemoryImage(
  path: string,
  dataWidth: number,
): Promise<LoadedMemoryImage> {
  return invoke<LoadedMemoryImage>('load_memory_image', { path, dataWidth })
}

export async function listenHardwareSynthesisLog(
  callback: (chunk: SynthesisLogChunkV1) => void,
): Promise<UnlistenFn> {
  return listen<SynthesisLogChunkV1>('hardware:synthesis_log', (event) => {
    callback(event.payload)
  })
}

export async function listenHardwareImplementationLog(
  callback: (chunk: ImplementationLogChunkV1) => void,
): Promise<UnlistenFn> {
  return listen<ImplementationLogChunkV1>('hardware:implementation_log', (event) => {
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
