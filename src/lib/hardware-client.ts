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

export type CanvasDeviceType = 'led' | 'switch'

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

export async function listenHardwareStateChanged(
  callback: (event: HardwareEventV1) => void,
): Promise<UnlistenFn> {
  return listen<HardwareEventV1>('hardware:state_changed', (event) => {
    callback(event.payload)
  })
}
