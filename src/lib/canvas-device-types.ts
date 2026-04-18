import type {
  CanvasDeviceBindingSnapshot,
  CanvasDeviceConfigSnapshot,
  CanvasDeviceDataSnapshot,
  CanvasDeviceSnapshot,
  CanvasHd44780BusMode,
  CanvasUartMode,
  CanvasVgaColorMode,
} from './hardware-client'
import type { MessageKey } from './i18n'

export type CanvasDeviceBindingSlot = {
  key: string
  label: string
}

export type CanvasMatrixDimensions = {
  rows: number
  columns: number
}

export type CanvasSegmentDisplayConfig = {
  digits: number
  activeLow: boolean
}

export type CanvasButtonConfig = {
  activeLow: boolean
}

export type CanvasVgaDisplayConfig = {
  columns: number
  rows: number
  colorMode: CanvasVgaColorMode
}

export type CanvasDipSwitchBankConfig = {
  width: number
}

export type CanvasLedBarConfig = {
  width: number
  activeLow: boolean
}

export type CanvasQuadratureEncoderConfig = {
  hasButton: boolean
}

export type CanvasMatrixKeypadConfig = {
  rows: number
  columns: number
  activeLow: boolean
}

export type CanvasUartTerminalConfig = {
  cyclesPerBit: number
  mode: CanvasUartMode
}

export type CanvasHd44780LcdConfig = {
  columns: number
  rows: number
  busMode: CanvasHd44780BusMode
}

export type CanvasDeviceShellSize = {
  width: number
  height: number
}

export type CanvasDeviceCapabilities = {
  drivesSignal: boolean
  receivesSignal: boolean
}

export type CanvasDeviceProjectPersistence = {
  persistIsOn?: boolean
  persistData?: boolean
}

export type CanvasDeviceState = {
  is_on: boolean
  color: string | null
  binding: CanvasDeviceBindingSnapshot
  config: CanvasDeviceConfigSnapshot
  data: CanvasDeviceDataSnapshot
}

export type CanvasDeviceDefinition = {
  titleKey: MessageKey
  aliases?: readonly string[]
  defaultState: () => CanvasDeviceState
  toRendererProps: (device: CanvasDeviceSnapshot) => Record<string, unknown>
  getShellSize: (device: CanvasDeviceSnapshot) => CanvasDeviceShellSize
  emitsToggle: boolean
  capabilities: CanvasDeviceCapabilities
  projectPersistence?: CanvasDeviceProjectPersistence
  getBindingSlots?: (device: CanvasDeviceSnapshot) => readonly CanvasDeviceBindingSlot[]
}
