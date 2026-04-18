import type {
  CanvasDeviceBindingSnapshot,
  CanvasDeviceDataSnapshot,
  CanvasDeviceSnapshot,
  CanvasHd44780BusMode,
  CanvasUartMode,
  CanvasVgaColorMode,
} from './hardware-client'
import type {
  CanvasButtonConfig,
  CanvasDeviceBindingSlot,
  CanvasDeviceState,
  CanvasDipSwitchBankConfig,
  CanvasHd44780LcdConfig,
  CanvasLedBarConfig,
  CanvasMatrixDimensions,
  CanvasMatrixKeypadConfig,
  CanvasQuadratureEncoderConfig,
  CanvasSegmentDisplayConfig,
  CanvasUartTerminalConfig,
  CanvasVgaDisplayConfig,
} from './canvas-device-types'

import { translate } from './i18n'

type CanvasDeviceColorOption = 'red' | 'green' | 'blue' | 'yellow' | 'orange' | 'white'

export const CANVAS_DEVICE_PRESET_COLORS: Record<CanvasDeviceColorOption, string> = {
  red: '#ef4444',
  green: '#4ade80',
  blue: '#3b82f6',
  yellow: '#eab308',
  orange: '#f97316',
  white: '#f4f4f5',
}

export const VGA_DISPLAY_RESOLUTION_PRESETS = [
  { columns: 160, rows: 120, key: 'qqvga' },
  { columns: 320, rows: 240, key: 'qvga' },
  { columns: 640, rows: 480, key: 'vga' },
  { columns: 800, rows: 600, key: 'svga' },
] as const

export function createSingleBinding(signal: string | null = null): CanvasDeviceBindingSnapshot {
  return { kind: 'single', signal }
}

export function createSlotBindings(
  signals: Array<string | null> = [],
): CanvasDeviceBindingSnapshot {
  return { kind: 'slots', signals: [...signals] }
}

function createNoConfig() {
  return { kind: 'none' } as const
}

function createNoData(): CanvasDeviceDataSnapshot {
  return { kind: 'none' }
}

export function createDefaultState(overrides: Partial<CanvasDeviceState> = {}): CanvasDeviceState {
  return {
    is_on: false,
    color: null,
    binding: createSingleBinding(),
    config: createNoConfig(),
    data: createNoData(),
    ...overrides,
  }
}

function clampInt(value: number | null | undefined, fallback: number, min = 1, max = 1024) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(min, Math.min(max, Math.round(value)))
}

export function defaultMatrixDimensions(): CanvasMatrixDimensions {
  return { rows: 8, columns: 8 }
}

export function defaultSegmentDisplayConfig(): CanvasSegmentDisplayConfig {
  return { digits: 1, activeLow: false }
}

export function defaultButtonConfig(): CanvasButtonConfig {
  return { activeLow: false }
}

export function defaultDipSwitchBankConfig(): CanvasDipSwitchBankConfig {
  return { width: 8 }
}

export function defaultLedBarConfig(): CanvasLedBarConfig {
  return { width: 8, activeLow: false }
}

export function defaultQuadratureEncoderConfig(): CanvasQuadratureEncoderConfig {
  return { hasButton: true }
}

export function defaultMatrixKeypadConfig(): CanvasMatrixKeypadConfig {
  return { rows: 4, columns: 4, activeLow: true }
}

export function defaultUartTerminalConfig(): CanvasUartTerminalConfig {
  return { cyclesPerBit: 16, mode: 'tx_rx' }
}

export function defaultHd44780Config(): CanvasHd44780LcdConfig {
  return { columns: 16, rows: 2, busMode: '4bit' }
}

export function defaultVgaDisplayConfig(): CanvasVgaDisplayConfig {
  return { columns: 320, rows: 240, colorMode: 'rgb332' }
}

function normalizeVgaColorMode(value: string | null | undefined, fallback: CanvasVgaColorMode) {
  if (
    value === 'mono' ||
    value === 'rgb111' ||
    value === 'rgb332' ||
    value === 'rgb444' ||
    value === 'rgb565' ||
    value === 'rgb888'
  ) {
    return value
  }

  return fallback
}

export function createBitset(length: number, fill = false) {
  return Array.from({ length }, () => fill)
}

export function createBusSlots(prefix: string, width: number) {
  return Array.from({ length: width }, (_, index) => ({
    key: `${prefix}-${index}`,
    label: `${prefix.toUpperCase()}${index}`,
  }))
}

export function createMatrixSlots(
  rows: number,
  columns: number,
  rowPrefix = 'ROW',
  colPrefix = 'COL',
) {
  return [
    ...Array.from({ length: rows }, (_, index) => ({
      key: `row-${index}`,
      label: `${rowPrefix}${index}`,
    })),
    ...Array.from({ length: columns }, (_, index) => ({
      key: `col-${index}`,
      label: `${colPrefix}${index}`,
    })),
  ]
}

function segmentSlots(): CanvasDeviceBindingSlot[] {
  return ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'].map((label, index) => ({
    key: `seg-${index}`,
    label,
  }))
}

export function segmentBindingSlots(digits: number): CanvasDeviceBindingSlot[] {
  if (digits <= 1) {
    return segmentSlots()
  }

  return [
    ...segmentSlots(),
    ...Array.from({ length: digits }, (_, index) => ({
      key: `digit-${index}`,
      label: translate('digitLabel', { index: index + 1 }),
    })),
  ]
}

export function vgaColorModeBitCounts(colorMode: CanvasVgaColorMode) {
  switch (colorMode) {
    case 'mono':
      return { redBits: 0, greenBits: 0, blueBits: 1 }
    case 'rgb111':
      return { redBits: 1, greenBits: 1, blueBits: 1 }
    case 'rgb444':
      return { redBits: 4, greenBits: 4, blueBits: 4 }
    case 'rgb565':
      return { redBits: 5, greenBits: 6, blueBits: 5 }
    case 'rgb888':
      return { redBits: 8, greenBits: 8, blueBits: 8 }
    case 'rgb332':
    default:
      return { redBits: 3, greenBits: 3, blueBits: 2 }
  }
}

export function vgaBindingSlots(colorMode: CanvasVgaColorMode): CanvasDeviceBindingSlot[] {
  const { redBits, greenBits, blueBits } = vgaColorModeBitCounts(colorMode)
  return [
    { key: 'hsync', label: 'HSYNC' },
    { key: 'vsync', label: 'VSYNC' },
    ...Array.from({ length: redBits }, (_, index) => ({ key: `r${index}`, label: `R${index}` })),
    ...Array.from({ length: greenBits }, (_, index) => ({
      key: `g${index}`,
      label: `G${index}`,
    })),
    ...Array.from({ length: blueBits }, (_, index) => ({ key: `b${index}`, label: `B${index}` })),
  ]
}

export function hd44780BindingSlots(busMode: CanvasHd44780BusMode) {
  const dataBits = busMode === '8bit' ? 8 : 4
  const base = [
    { key: 'rs', label: 'RS' },
    { key: 'e', label: 'E' },
    { key: 'rw', label: 'RW' },
  ]
  const dataSlots = Array.from({ length: dataBits }, (_, index) => {
    const bit = busMode === '8bit' ? index : index + 4
    return { key: `d${bit}`, label: `D${bit}` }
  })
  return [...base, ...dataSlots]
}

export function uartBindingSlots(mode: CanvasUartMode) {
  if (mode === 'tx') {
    return [{ key: 'tx', label: 'TX' }]
  }
  if (mode === 'rx') {
    return [{ key: 'rx', label: 'RX' }]
  }
  return [
    { key: 'rx', label: 'RX' },
    { key: 'tx', label: 'TX' },
  ]
}

export function getCanvasMatrixDimensions(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasMatrixDimensions | null {
  if (device.type !== 'led_matrix') {
    return null
  }

  const defaults = defaultMatrixDimensions()
  if (device.state.config.kind !== 'led_matrix') {
    return defaults
  }

  return {
    rows: clampInt(device.state.config.rows, defaults.rows, 1, 64),
    columns: clampInt(device.state.config.columns, defaults.columns, 1, 64),
  }
}

export function getCanvasSegmentDisplayConfig(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasSegmentDisplayConfig | null {
  if (device.type !== 'segment_display') {
    return null
  }

  const defaults = defaultSegmentDisplayConfig()
  if (device.state.config.kind !== 'segment_display') {
    return defaults
  }

  return {
    digits: clampInt(device.state.config.digits, defaults.digits, 1, 16),
    activeLow: device.state.config.active_low ?? defaults.activeLow,
  }
}

export function getCanvasButtonConfig(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasButtonConfig | null {
  if (device.type !== 'button') {
    return null
  }

  const defaults = defaultButtonConfig()
  if (device.state.config.kind !== 'button') {
    return defaults
  }

  return {
    activeLow: device.state.config.active_low ?? defaults.activeLow,
  }
}

export function getCanvasVgaDisplayConfig(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasVgaDisplayConfig | null {
  if (device.type !== 'vga_display') {
    return null
  }

  const defaults = defaultVgaDisplayConfig()
  if (device.state.config.kind !== 'vga_display') {
    return defaults
  }

  return {
    columns: clampInt(device.state.config.columns, defaults.columns, 1, 2048),
    rows: clampInt(device.state.config.rows, defaults.rows, 1, 2048),
    colorMode: normalizeVgaColorMode(device.state.config.color_mode, defaults.colorMode),
  }
}

export function getCanvasDipSwitchBankConfig(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasDipSwitchBankConfig | null {
  if (device.type !== 'dip_switch_bank') {
    return null
  }

  const defaults = defaultDipSwitchBankConfig()
  if (device.state.config.kind !== 'dip_switch_bank') {
    return defaults
  }

  return { width: clampInt(device.state.config.width, defaults.width, 1, 32) }
}

export function getCanvasLedBarConfig(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasLedBarConfig | null {
  if (device.type !== 'led_bar') {
    return null
  }

  const defaults = defaultLedBarConfig()
  if (device.state.config.kind !== 'led_bar') {
    return defaults
  }

  return {
    width: clampInt(device.state.config.width, defaults.width, 1, 32),
    activeLow: device.state.config.active_low ?? defaults.activeLow,
  }
}

export function getCanvasQuadratureEncoderConfig(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasQuadratureEncoderConfig | null {
  if (device.type !== 'quadrature_encoder') {
    return null
  }

  const defaults = defaultQuadratureEncoderConfig()
  if (device.state.config.kind !== 'quadrature_encoder') {
    return defaults
  }

  return {
    hasButton: device.state.config.has_button ?? defaults.hasButton,
  }
}

export function getCanvasMatrixKeypadConfig(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasMatrixKeypadConfig | null {
  if (device.type !== 'matrix_keypad') {
    return null
  }

  const defaults = defaultMatrixKeypadConfig()
  if (device.state.config.kind !== 'matrix_keypad') {
    return defaults
  }

  return {
    rows: clampInt(device.state.config.rows, defaults.rows, 1, 8),
    columns: clampInt(device.state.config.columns, defaults.columns, 1, 8),
    activeLow: device.state.config.active_low ?? defaults.activeLow,
  }
}

export function getCanvasUartTerminalConfig(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasUartTerminalConfig | null {
  if (device.type !== 'uart_terminal') {
    return null
  }

  const defaults = defaultUartTerminalConfig()
  if (device.state.config.kind !== 'uart_terminal') {
    return defaults
  }

  return {
    cyclesPerBit: clampInt(device.state.config.cycles_per_bit, defaults.cyclesPerBit, 1, 4096),
    mode: device.state.config.mode,
  }
}

export function getCanvasHd44780LcdConfig(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasHd44780LcdConfig | null {
  if (device.type !== 'hd44780_lcd') {
    return null
  }

  const defaults = defaultHd44780Config()
  if (device.state.config.kind !== 'hd44780_lcd') {
    return defaults
  }

  return {
    columns: clampInt(device.state.config.columns, defaults.columns, 8, 40),
    rows: clampInt(device.state.config.rows, defaults.rows, 1, 4),
    busMode: device.state.config.bus_mode,
  }
}

export function getCanvasDeviceBoundSignal(
  device: Pick<CanvasDeviceSnapshot, 'state'>,
): string | null {
  if (device.state.binding.kind !== 'single') {
    return null
  }

  return device.state.binding.signal ?? null
}

export function getCanvasDeviceBoundSignals(
  device: Pick<CanvasDeviceSnapshot, 'state'>,
): Array<string | null> {
  if (device.state.binding.kind !== 'slots') {
    return []
  }

  return device.state.binding.signals
}

export function getCanvasDeviceBoundSignalCount(
  device: Pick<CanvasDeviceSnapshot, 'state'>,
): number {
  if (device.state.binding.kind === 'single') {
    return device.state.binding.signal ? 1 : 0
  }

  return device.state.binding.signals.filter(Boolean).length
}

export function getCanvasBitsetData(device: Pick<CanvasDeviceSnapshot, 'state'>, width = 0) {
  if (device.state.data.kind !== 'bitset') {
    return createBitset(width)
  }

  const bits = device.state.data.bits
  return Array.from({ length: Math.max(width, bits.length) }, (_, index) => {
    return bits[index] ?? false
  })
}

export function getCanvasQuadratureEncoderData(device: Pick<CanvasDeviceSnapshot, 'state'>) {
  if (device.state.data.kind !== 'quadrature_encoder') {
    return { phase: 0, buttonPressed: false }
  }

  return {
    phase: clampInt(device.state.data.phase, 0, 0, 3),
    buttonPressed: device.state.data.button_pressed,
  }
}

export function getCanvasMatrixKeypadData(device: Pick<CanvasDeviceSnapshot, 'state'>) {
  if (device.state.data.kind !== 'matrix_keypad') {
    return {
      pressedRow: null,
      pressedColumn: null,
    }
  }

  return {
    pressedRow: device.state.data.pressed_row ?? null,
    pressedColumn: device.state.data.pressed_column ?? null,
  }
}

export function getCanvasDeviceDrivenSignalLevel(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): boolean {
  if (device.type === 'button') {
    const config = getCanvasButtonConfig(device)
    if (config?.activeLow) {
      return !device.state.is_on
    }
  }

  return device.state.is_on
}

export function normalizeCanvasDeviceColor(value: string | null | undefined) {
  if (!value) {
    return null
  }

  const trimmed = value.trim().toLowerCase()
  if (trimmed in CANVAS_DEVICE_PRESET_COLORS) {
    return CANVAS_DEVICE_PRESET_COLORS[trimmed as CanvasDeviceColorOption]
  }

  const hexMatch = trimmed.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/)
  if (!hexMatch) {
    return null
  }

  if (hexMatch[1].length === 3) {
    return `#${hexMatch[1]
      .split('')
      .map((digit) => `${digit}${digit}`)
      .join('')}`
  }

  return `#${hexMatch[1]}`
}

export function resolveCanvasDeviceColor(device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>) {
  const color = normalizeCanvasDeviceColor(device.state.color)
  if (color) {
    return color
  }

  if (device.type === 'led_matrix' || device.type === 'led_bar') {
    return CANVAS_DEVICE_PRESET_COLORS.green
  }

  if (device.type === 'led') {
    return CANVAS_DEVICE_PRESET_COLORS.red
  }

  return null
}
