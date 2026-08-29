import type {
  CanvasDeviceType,
  HardwareAccessConfigV1,
  HardwareActionV1,
  HardwareBoardInfoV1,
  HardwareCanvasDeviceTelemetry,
  HardwareDataBatchBinaryV1,
  HardwareDataSignalCatalogV1,
  HardwareDataStreamConfigV1,
  HardwareDataStreamStatusV1,
  HardwareEventV1,
  HardwareStateV1,
  HardwareWaveformBatchBinaryV1,
  ImplementationLogChunkV1,
  ImplementationReportV1,
  ImplementationRequestV1,
  SynthesisLogChunkV1,
  SynthesisReportV1,
  SynthesisRequestV1,
} from '@/generated/tauri-contract'

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

export type * from '@/generated/tauri-contract'

export const CANVAS_DEVICE_TYPES = [
  'led',
  'switch',
  'button',
  'dip_switch_bank',
  'led_bar',
  'audio_pwm',
  'quadrature_encoder',
  'uart_terminal',
  'hd44780_lcd',
  'vga_display',
  'segment_display',
  'led_matrix',
] as const satisfies readonly CanvasDeviceType[]

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

export async function hardwareGetState(): Promise<HardwareStateV1> {
  return invoke<HardwareStateV1>('hardware_get_state')
}

export async function hardwareListBoards(): Promise<HardwareBoardInfoV1[]> {
  return invoke<HardwareBoardInfoV1[]>('hardware_list_boards')
}

export async function configureHardwareAccess(
  config: HardwareAccessConfigV1,
): Promise<HardwareAccessConfigV1> {
  return invoke<HardwareAccessConfigV1>('configure_hardware_access', { config })
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

export async function hardwareGetWaveformSnapshot(
  afterSequence?: number,
): Promise<HardwareWaveformBatchBinaryV1 | null> {
  return invoke<HardwareWaveformBatchBinaryV1 | null>('hardware_get_waveform_snapshot', {
    afterSequence,
  })
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

export async function setHardwareWaveformEnabled(enabled: boolean): Promise<void> {
  await invoke('set_hardware_waveform_enabled', {
    enabled,
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

export async function listenHardwareDataStreamStatus(
  callback: (status: HardwareDataStreamStatusV1) => void,
): Promise<UnlistenFn> {
  return listen<HardwareDataStreamStatusV1>('hardware:data_stream_status_changed', (event) => {
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
  callback: (snapshot: HardwareCanvasDeviceTelemetry) => void,
): Promise<UnlistenFn> {
  return listen<HardwareCanvasDeviceTelemetry>('hardware:device_snapshot', (event) => {
    callback(event.payload)
  })
}
