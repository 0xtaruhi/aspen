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
  | 'four_digit_segment_display'
  | 'led4x4_matrix'
  | 'led8x8_matrix'
  | 'led16x16_matrix'

export interface CanvasDeviceStateSnapshot {
  is_on: boolean
  color: string | null
  bound_signal: string | null
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

export interface HardwareDataStreamStatusV1 {
  running: boolean
  sequence: number
  dropped_samples: number
  queue_fill: number
  queue_capacity: number
  last_batch_at_ms: number
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

export async function hardwareGetDataStreamStatus(): Promise<HardwareDataStreamStatusV1> {
  return invoke<HardwareDataStreamStatusV1>('hardware_get_data_stream_status')
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
