import type {
  CanvasDeviceBindingSnapshot,
  CanvasDeviceConfigSnapshot,
  CanvasDeviceDataSnapshot,
  CanvasDeviceSnapshot,
  CanvasDeviceType,
  CanvasHd44780BusMode,
  CanvasMemoryMode,
  CanvasUartMode,
  CanvasVgaColorMode,
} from './hardware-client'
import { alignShellSize, measureMatrixShellSize } from './device-shell-metrics'
import { translate } from './i18n'

type CanvasDeviceCapabilities = {
  drivesSignal: boolean
  receivesSignal: boolean
}

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

export type CanvasMemoryConfig = {
  mode: CanvasMemoryMode
  addressWidth: number
  dataWidth: number
}

export type CanvasMemoryData = {
  words: number[]
  sourcePath: string | null
  previewOffset: number
}

export type CanvasDeviceShellSize = {
  width: number
  height: number
}

export type CanvasDeviceColorOption = 'red' | 'green' | 'blue' | 'yellow' | 'orange' | 'white'

export const CANVAS_DEVICE_PRESET_COLORS: Record<CanvasDeviceColorOption, string> = {
  red: '#ef4444',
  green: '#4ade80',
  blue: '#3b82f6',
  yellow: '#eab308',
  orange: '#f97316',
  white: '#f4f4f5',
}

export const CANVAS_MEMORY_MAX_ADDRESS_WIDTH = 16
export const CANVAS_MEMORY_PREVIEW_WORDS = 16

type CanvasDeviceDefinition = {
  title: string
  dropAliases: string[]
  defaultState: () => CanvasDeviceState
  toRendererProps: (device: CanvasDeviceSnapshot) => Record<string, unknown>
  getShellSize: (device: CanvasDeviceSnapshot) => CanvasDeviceShellSize
  emitsToggle: boolean
  capabilities: CanvasDeviceCapabilities
  getBindingSlots?: (device: CanvasDeviceSnapshot) => readonly CanvasDeviceBindingSlot[]
}

type CanvasDeviceState = {
  is_on: boolean
  color: string | null
  binding: CanvasDeviceBindingSnapshot
  config: CanvasDeviceConfigSnapshot
  data: CanvasDeviceDataSnapshot
}

function createSingleBinding(signal: string | null = null): CanvasDeviceBindingSnapshot {
  return { kind: 'single', signal }
}

function createSlotBindings(signals: Array<string | null> = []): CanvasDeviceBindingSnapshot {
  return { kind: 'slots', signals: [...signals] }
}

function createNoConfig(): CanvasDeviceConfigSnapshot {
  return { kind: 'none' }
}

function createNoData(): CanvasDeviceDataSnapshot {
  return { kind: 'none' }
}

function createDefaultState(overrides: Partial<CanvasDeviceState> = {}): CanvasDeviceState {
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

function defaultMatrixDimensionsForType(): CanvasMatrixDimensions {
  return { rows: 8, columns: 8 }
}

function defaultSegmentDisplayConfig(): CanvasSegmentDisplayConfig {
  return { digits: 1, activeLow: false }
}

function defaultButtonConfig(): CanvasButtonConfig {
  return { activeLow: false }
}

function defaultDipSwitchBankConfig(): CanvasDipSwitchBankConfig {
  return { width: 8 }
}

function defaultLedBarConfig(): CanvasLedBarConfig {
  return { width: 8, activeLow: false }
}

function defaultQuadratureEncoderConfig(): CanvasQuadratureEncoderConfig {
  return { hasButton: true }
}

function defaultMatrixKeypadConfig(): CanvasMatrixKeypadConfig {
  return { rows: 4, columns: 4, activeLow: true }
}

function defaultUartTerminalConfig(): CanvasUartTerminalConfig {
  return { cyclesPerBit: 16, mode: 'tx_rx' }
}

function defaultHd44780Config(): CanvasHd44780LcdConfig {
  return { columns: 16, rows: 2, busMode: '4bit' }
}

function defaultMemoryConfig(): CanvasMemoryConfig {
  return { mode: 'ram', addressWidth: 8, dataWidth: 8 }
}

export const VGA_DISPLAY_RESOLUTION_PRESETS = [
  { columns: 160, rows: 120, key: 'qqvga' },
  { columns: 320, rows: 240, key: 'qvga' },
  { columns: 640, rows: 480, key: 'vga' },
  { columns: 800, rows: 600, key: 'svga' },
] as const

function defaultVgaDisplayConfig(): CanvasVgaDisplayConfig {
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

function defaultMemoryWords(config: CanvasMemoryConfig) {
  const wordCount = 1 << Math.min(config.addressWidth, CANVAS_MEMORY_MAX_ADDRESS_WIDTH)
  return Array.from({ length: wordCount }, () => 0)
}

function defaultMemoryData(config: CanvasMemoryConfig): CanvasMemoryData {
  return {
    words: defaultMemoryWords(config),
    sourcePath: null,
    previewOffset: 0,
  }
}

function createBitset(length: number, fill = false) {
  return Array.from({ length }, () => fill)
}

function createBusSlots(prefix: string, width: number) {
  return Array.from({ length: width }, (_, index) => ({
    key: `${prefix}-${index}`,
    label: `${prefix.toUpperCase()}${index}`,
  }))
}

function createMatrixSlots(rows: number, columns: number, rowPrefix = 'ROW', colPrefix = 'COL') {
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

function segmentBindingSlots(digits: number): CanvasDeviceBindingSlot[] {
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

function vgaBindingSlots(colorMode: CanvasVgaColorMode): CanvasDeviceBindingSlot[] {
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

function hd44780BindingSlots(busMode: CanvasHd44780BusMode) {
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

function uartBindingSlots(mode: CanvasUartMode) {
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

function memoryBindingSlots(config: CanvasMemoryConfig) {
  if (config.mode === 'rom') {
    return [
      ...createBusSlots('A', config.addressWidth),
      ...createBusSlots('DOUT', config.dataWidth),
      { key: 'cs', label: 'CS' },
      { key: 'oe', label: 'OE' },
    ]
  }

  return [
    ...createBusSlots('A', config.addressWidth),
    ...createBusSlots('DIN', config.dataWidth),
    ...createBusSlots('DOUT', config.dataWidth),
    { key: 'cs', label: 'CS' },
    { key: 'oe', label: 'OE' },
    { key: 'we', label: 'WE' },
  ]
}

export function isCanvasMatrixDevice(type: CanvasDeviceType): type is 'led_matrix' {
  return type === 'led_matrix'
}

export function isCanvasSegmentDisplayDevice(type: CanvasDeviceType): type is 'segment_display' {
  return type === 'segment_display'
}

export function getCanvasMatrixDimensions(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasMatrixDimensions | null {
  if (device.type !== 'led_matrix') {
    return null
  }

  const defaults = defaultMatrixDimensionsForType()
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

export function getCanvasMemoryConfig(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasMemoryConfig | null {
  if (device.type !== 'memory') {
    return null
  }

  const defaults = defaultMemoryConfig()
  if (device.state.config.kind !== 'memory') {
    return defaults
  }

  return {
    mode: device.state.config.mode,
    addressWidth: clampInt(
      device.state.config.address_width,
      defaults.addressWidth,
      1,
      CANVAS_MEMORY_MAX_ADDRESS_WIDTH,
    ),
    dataWidth: clampInt(device.state.config.data_width, defaults.dataWidth, 1, 16),
  }
}

export function getCanvasMemoryData(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
  fallbackCount?: number,
): CanvasMemoryData {
  const config =
    device.type === 'memory' ? (getCanvasMemoryConfig(device) ?? defaultMemoryConfig()) : null
  const fallbackWords = Array.from({ length: fallbackCount ?? 0 }, () => 0)

  if (device.state.data.kind !== 'memory') {
    return {
      words: config ? defaultMemoryWords(config) : fallbackWords,
      sourcePath: null,
      previewOffset: 0,
    }
  }

  const memoryData = device.state.data
  const targetCount =
    fallbackCount ??
    (config ? 1 << Math.min(config.addressWidth, CANVAS_MEMORY_MAX_ADDRESS_WIDTH) : undefined) ??
    memoryData.words.length
  const words = Array.from({ length: targetCount }, (_, index) => memoryData.words[index] ?? 0)
  const maxOffset = Math.max(0, words.length - 1)

  return {
    words,
    sourcePath: memoryData.source_path ?? null,
    previewOffset: clampInt(memoryData.preview_offset, 0, 0, maxOffset),
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

export function getCanvasQueuedBytesData(device: Pick<CanvasDeviceSnapshot, 'state'>) {
  if (device.state.data.kind !== 'queued_bytes') {
    return []
  }

  return [...device.state.data.bytes]
}

export function getCanvasMemoryWordsData(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
  fallbackCount?: number,
) {
  return getCanvasMemoryData(device, fallbackCount).words
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

function createMatrixDeviceDefinition(
  title: string,
  dropAliases: string[],
): CanvasDeviceDefinition {
  const defaults = defaultMatrixDimensionsForType()

  return {
    title,
    dropAliases,
    defaultState: () =>
      createDefaultState({
        color: CANVAS_DEVICE_PRESET_COLORS.green,
        binding: createSlotBindings(
          Array.from({ length: defaults.rows + defaults.columns }, () => null),
        ),
        config: { kind: 'led_matrix', rows: defaults.rows, columns: defaults.columns },
      }),
    toRendererProps: (device) => {
      const dimensions = getCanvasMatrixDimensions(device) ?? defaults
      return {
        isOn: device.state.is_on,
        color: resolveCanvasDeviceColor(device) ?? CANVAS_DEVICE_PRESET_COLORS.green,
        rows: dimensions.rows,
        columns: dimensions.columns,
      }
    },
    getShellSize: (device) => {
      const dimensions = getCanvasMatrixDimensions(device) ?? defaults
      return measureMatrixShellSize(dimensions.columns, dimensions.rows)
    },
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
    getBindingSlots: (device) => {
      const dimensions = getCanvasMatrixDimensions(device) ?? defaults
      return createMatrixSlots(dimensions.rows, dimensions.columns, 'ROW', 'COL')
    },
  }
}

function createSegmentDisplayDefinition(): CanvasDeviceDefinition {
  const defaults = defaultSegmentDisplayConfig()
  return {
    title: translate('segmentDisplay'),
    dropAliases: ['segment_display'],
    defaultState: () =>
      createDefaultState({
        binding: createSlotBindings(Array.from({ length: 8 }, () => null)),
        config: {
          kind: 'segment_display',
          digits: defaults.digits,
          active_low: defaults.activeLow,
        },
      }),
    toRendererProps: (device) => {
      const config = getCanvasSegmentDisplayConfig(device) ?? defaults
      return { digits: config.digits, isOn: device.state.is_on }
    },
    getShellSize: (device) => {
      const config = getCanvasSegmentDisplayConfig(device) ?? defaults
      return { width: alignShellSize(52 + config.digits * 42), height: 160 }
    },
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
    getBindingSlots: (device) => {
      const config = getCanvasSegmentDisplayConfig(device) ?? defaults
      return segmentBindingSlots(config.digits)
    },
  }
}

function createVgaDisplayDefinition(): CanvasDeviceDefinition {
  const defaults = defaultVgaDisplayConfig()
  return {
    title: translate('vgaDisplay'),
    dropAliases: ['vga_display', 'vga'],
    defaultState: () =>
      createDefaultState({
        binding: createSlotBindings(
          Array.from({ length: vgaBindingSlots(defaults.colorMode).length }, () => null),
        ),
        config: {
          kind: 'vga_display',
          columns: defaults.columns,
          rows: defaults.rows,
          color_mode: defaults.colorMode,
        },
      }),
    toRendererProps: (device) => ({
      isOn: device.state.is_on,
      columns: getCanvasVgaDisplayConfig(device)?.columns ?? defaults.columns,
      rows: getCanvasVgaDisplayConfig(device)?.rows ?? defaults.rows,
    }),
    getShellSize: () => ({ width: alignShellSize(420), height: alignShellSize(320) }),
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
    getBindingSlots: (device) => {
      const config = getCanvasVgaDisplayConfig(device) ?? defaults
      return vgaBindingSlots(config.colorMode)
    },
  }
}

const canvasDeviceDefinitions: Record<CanvasDeviceType, CanvasDeviceDefinition> = {
  led: {
    title: translate('led'),
    dropAliases: ['led'],
    defaultState: () =>
      createDefaultState({
        color: CANVAS_DEVICE_PRESET_COLORS.red,
        binding: createSingleBinding(),
      }),
    toRendererProps: (device) => ({
      isOn: device.state.is_on,
      color: resolveCanvasDeviceColor(device) || undefined,
    }),
    getShellSize: () => ({ width: 80, height: 100 }),
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
  },
  switch: {
    title: translate('switchDevice'),
    dropAliases: ['switch'],
    defaultState: () => createDefaultState({ binding: createSingleBinding() }),
    toRendererProps: (device) => ({ isOn: device.state.is_on }),
    getShellSize: () => ({ width: 100, height: 160 }),
    emitsToggle: true,
    capabilities: { drivesSignal: true, receivesSignal: false },
  },
  button: {
    title: translate('button'),
    dropAliases: ['button'],
    defaultState: () =>
      createDefaultState({
        binding: createSingleBinding(),
        config: { kind: 'button', active_low: false },
      }),
    toRendererProps: (device) => ({ isOn: device.state.is_on }),
    getShellSize: () => ({ width: 100, height: 100 }),
    emitsToggle: true,
    capabilities: { drivesSignal: true, receivesSignal: false },
  },
  dip_switch_bank: {
    title: translate('dipSwitchBank'),
    dropAliases: ['dip_switch_bank', 'dip'],
    defaultState: () => {
      const defaults = defaultDipSwitchBankConfig()
      return createDefaultState({
        binding: createSlotBindings(Array.from({ length: defaults.width }, () => null)),
        config: { kind: 'dip_switch_bank', width: defaults.width },
        data: { kind: 'bitset', bits: createBitset(defaults.width) },
      })
    },
    toRendererProps: (device) => {
      const config = getCanvasDipSwitchBankConfig(device) ?? defaultDipSwitchBankConfig()
      return { width: config.width, bits: getCanvasBitsetData(device, config.width) }
    },
    getShellSize: (device) => {
      const config = getCanvasDipSwitchBankConfig(device) ?? defaultDipSwitchBankConfig()
      return { width: alignShellSize(48 + config.width * 28), height: 140 }
    },
    emitsToggle: false,
    capabilities: { drivesSignal: true, receivesSignal: false },
    getBindingSlots: (device) => {
      const config = getCanvasDipSwitchBankConfig(device) ?? defaultDipSwitchBankConfig()
      return createBusSlots('SW', config.width)
    },
  },
  led_bar: {
    title: translate('ledBar'),
    dropAliases: ['led_bar'],
    defaultState: () => {
      const defaults = defaultLedBarConfig()
      return createDefaultState({
        color: CANVAS_DEVICE_PRESET_COLORS.green,
        binding: createSlotBindings(Array.from({ length: defaults.width }, () => null)),
        config: { kind: 'led_bar', width: defaults.width, active_low: defaults.activeLow },
      })
    },
    toRendererProps: (device) => {
      const config = getCanvasLedBarConfig(device) ?? defaultLedBarConfig()
      return {
        width: config.width,
        activeLow: config.activeLow,
        color: resolveCanvasDeviceColor(device) ?? CANVAS_DEVICE_PRESET_COLORS.green,
      }
    },
    getShellSize: (device) => {
      const config = getCanvasLedBarConfig(device) ?? defaultLedBarConfig()
      return { width: alignShellSize(48 + config.width * 24), height: 120 }
    },
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
    getBindingSlots: (device) => {
      const config = getCanvasLedBarConfig(device) ?? defaultLedBarConfig()
      return createBusSlots('LED', config.width)
    },
  },
  quadrature_encoder: {
    title: translate('quadratureEncoder'),
    dropAliases: ['quadrature_encoder', 'encoder'],
    defaultState: () => {
      const defaults = defaultQuadratureEncoderConfig()
      return createDefaultState({
        binding: createSlotBindings(Array.from({ length: defaults.hasButton ? 3 : 2 }, () => null)),
        config: { kind: 'quadrature_encoder', has_button: defaults.hasButton },
        data: { kind: 'quadrature_encoder', phase: 0, button_pressed: false },
      })
    },
    toRendererProps: (device) => {
      const config = getCanvasQuadratureEncoderConfig(device) ?? defaultQuadratureEncoderConfig()
      const data = getCanvasQuadratureEncoderData(device)
      return { hasButton: config.hasButton, phase: data.phase, buttonPressed: data.buttonPressed }
    },
    getShellSize: () => ({ width: 200, height: 180 }),
    emitsToggle: false,
    capabilities: { drivesSignal: true, receivesSignal: false },
    getBindingSlots: (device) => {
      const config = getCanvasQuadratureEncoderConfig(device) ?? defaultQuadratureEncoderConfig()
      return [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        ...(config.hasButton ? [{ key: 'sw', label: 'SW' }] : []),
      ]
    },
  },
  audio_pwm: {
    title: translate('audioPwm'),
    dropAliases: ['audio_pwm', 'audio', 'buzzer'],
    defaultState: () => createDefaultState({ binding: createSingleBinding() }),
    toRendererProps: () => ({}),
    getShellSize: () => ({ width: 260, height: 140 }),
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
  },
  matrix_keypad: {
    title: translate('matrixKeypad'),
    dropAliases: ['matrix_keypad'],
    defaultState: () => {
      const defaults = defaultMatrixKeypadConfig()
      return createDefaultState({
        binding: createSlotBindings(
          Array.from({ length: defaults.rows + defaults.columns }, () => null),
        ),
        config: {
          kind: 'matrix_keypad',
          rows: defaults.rows,
          columns: defaults.columns,
          active_low: defaults.activeLow,
        },
        data: { kind: 'matrix_keypad', pressed_row: null, pressed_column: null },
      })
    },
    toRendererProps: (device) => {
      const config = getCanvasMatrixKeypadConfig(device) ?? defaultMatrixKeypadConfig()
      const data = getCanvasMatrixKeypadData(device)
      return {
        rows: config.rows,
        columns: config.columns,
        pressedRow: data.pressedRow,
        pressedColumn: data.pressedColumn,
      }
    },
    getShellSize: (device) => {
      const config = getCanvasMatrixKeypadConfig(device) ?? defaultMatrixKeypadConfig()
      return {
        width: alignShellSize(84 + config.columns * 56),
        height: alignShellSize(96 + config.rows * 56),
      }
    },
    emitsToggle: false,
    capabilities: { drivesSignal: true, receivesSignal: true },
    getBindingSlots: (device) => {
      const config = getCanvasMatrixKeypadConfig(device) ?? defaultMatrixKeypadConfig()
      return createMatrixSlots(config.rows, config.columns, 'ROW', 'COL')
    },
  },
  uart_terminal: {
    title: translate('uartTerminal'),
    dropAliases: ['uart_terminal', 'uart'],
    defaultState: () => {
      const defaults = defaultUartTerminalConfig()
      return createDefaultState({
        binding: createSlotBindings(
          Array.from({ length: uartBindingSlots(defaults.mode).length }, () => null),
        ),
        config: {
          kind: 'uart_terminal',
          cycles_per_bit: defaults.cyclesPerBit,
          mode: defaults.mode,
        },
        data: { kind: 'queued_bytes', bytes: [] },
      })
    },
    toRendererProps: () => ({}),
    getShellSize: () => ({ width: 360, height: 260 }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: true,
      receivesSignal: true,
    },
    getBindingSlots: (device) => {
      const config = getCanvasUartTerminalConfig(device) ?? defaultUartTerminalConfig()
      return uartBindingSlots(config.mode)
    },
  },
  hd44780_lcd: {
    title: translate('hd44780Lcd'),
    dropAliases: ['hd44780_lcd', 'lcd'],
    defaultState: () => {
      const defaults = defaultHd44780Config()
      return createDefaultState({
        binding: createSlotBindings(
          Array.from({ length: hd44780BindingSlots(defaults.busMode).length }, () => null),
        ),
        config: {
          kind: 'hd44780_lcd',
          columns: defaults.columns,
          rows: defaults.rows,
          bus_mode: defaults.busMode,
        },
      })
    },
    toRendererProps: (device) => {
      const config = getCanvasHd44780LcdConfig(device) ?? defaultHd44780Config()
      return { columns: config.columns, rows: config.rows, busMode: config.busMode }
    },
    getShellSize: (device) => {
      const config = getCanvasHd44780LcdConfig(device) ?? defaultHd44780Config()
      return {
        width: alignShellSize(150 + config.columns * 11),
        height: alignShellSize(86 + config.rows * 24),
      }
    },
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
    getBindingSlots: (device) => {
      const config = getCanvasHd44780LcdConfig(device) ?? defaultHd44780Config()
      return hd44780BindingSlots(config.busMode)
    },
  },
  memory: {
    title: translate('memoryDevice'),
    dropAliases: ['memory', 'rom', 'ram'],
    defaultState: () => {
      const defaults = defaultMemoryConfig()
      return createDefaultState({
        binding: createSlotBindings(
          Array.from({ length: memoryBindingSlots(defaults).length }, () => null),
        ),
        config: {
          kind: 'memory',
          mode: defaults.mode,
          address_width: defaults.addressWidth,
          data_width: defaults.dataWidth,
        },
        data: {
          kind: 'memory',
          words: defaultMemoryData(defaults).words,
          source_path: null,
          preview_offset: 0,
        },
      })
    },
    toRendererProps: (device) => {
      const config = getCanvasMemoryConfig(device) ?? defaultMemoryConfig()
      const data = getCanvasMemoryData(device)
      return {
        mode: config.mode,
        addressWidth: config.addressWidth,
        dataWidth: config.dataWidth,
        wordCount: 1 << Math.min(config.addressWidth, CANVAS_MEMORY_MAX_ADDRESS_WIDTH),
        sourcePath: data.sourcePath,
        previewOffset: data.previewOffset,
      }
    },
    getShellSize: () => ({ width: 360, height: 260 }),
    emitsToggle: false,
    capabilities: { drivesSignal: true, receivesSignal: true },
    getBindingSlots: (device) => {
      const config = getCanvasMemoryConfig(device) ?? defaultMemoryConfig()
      return memoryBindingSlots(config)
    },
  },
  vga_display: createVgaDisplayDefinition(),
  segment_display: createSegmentDisplayDefinition(),
  led_matrix: createMatrixDeviceDefinition(translate('matrix'), ['led_matrix', 'matrix']),
}

const dropAliasToType = new Map<string, CanvasDeviceType>(
  Object.entries(canvasDeviceDefinitions).flatMap(([type, definition]) => {
    return definition.dropAliases.map((alias) => [alias, type as CanvasDeviceType])
  }),
)

export function getCanvasDeviceDefinition(type: CanvasDeviceType): CanvasDeviceDefinition {
  return canvasDeviceDefinitions[type]
}

export function resolveCanvasDeviceType(rawType?: string): CanvasDeviceType | null {
  if (!rawType) {
    return null
  }

  return dropAliasToType.get(rawType.toLowerCase()) ?? null
}

export function createCanvasDeviceSnapshot(
  type: CanvasDeviceType,
  id: string,
  x: number,
  y: number,
  index: number,
): CanvasDeviceSnapshot {
  const definition = getCanvasDeviceDefinition(type)
  return {
    id,
    type,
    x,
    y,
    label: `${definition.title} ${index}`,
    state: definition.defaultState(),
  }
}

export function getCanvasDeviceRendererProps(
  device: CanvasDeviceSnapshot,
): Record<string, unknown> {
  return getCanvasDeviceDefinition(device.type).toRendererProps(device)
}

export function getCanvasDeviceShellSize(device: CanvasDeviceSnapshot): CanvasDeviceShellSize {
  return getCanvasDeviceDefinition(device.type).getShellSize(device)
}

export function canvasDeviceEmitsToggle(type: CanvasDeviceType): boolean {
  return getCanvasDeviceDefinition(type).emitsToggle
}

export function deviceDrivesSignal(type: CanvasDeviceType): boolean {
  return getCanvasDeviceDefinition(type).capabilities.drivesSignal
}

export function deviceReceivesSignal(type: CanvasDeviceType): boolean {
  return getCanvasDeviceDefinition(type).capabilities.receivesSignal
}

export function getCanvasDeviceBindingSlots(
  device: CanvasDeviceSnapshot,
): readonly CanvasDeviceBindingSlot[] {
  return getCanvasDeviceDefinition(device.type).getBindingSlots?.(device) ?? []
}
