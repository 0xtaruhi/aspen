import type {
  CanvasDeviceBindingSnapshot,
  CanvasDeviceConfigSnapshot,
  CanvasDeviceSnapshot,
  CanvasDeviceStateSnapshot,
  CanvasDeviceType,
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

type CanvasDeviceDefinition = {
  title: string
  dropAliases: string[]
  defaultState: () => CanvasDeviceStateSnapshot
  toRendererProps: (device: CanvasDeviceSnapshot) => Record<string, unknown>
  getShellSize: (device: CanvasDeviceSnapshot) => CanvasDeviceShellSize
  emitsToggle: boolean
  capabilities: CanvasDeviceCapabilities
  getBindingSlots?: (device: CanvasDeviceSnapshot) => readonly CanvasDeviceBindingSlot[]
}

type MatrixCanvasDeviceType = 'led_matrix'
type SegmentCanvasDeviceType = 'segment_display'

function createSingleBinding(signal: string | null = null): CanvasDeviceBindingSnapshot {
  return {
    kind: 'single',
    signal,
  }
}

function createSlotBindings(signals: Array<string | null> = []): CanvasDeviceBindingSnapshot {
  return {
    kind: 'slots',
    signals: [...signals],
  }
}

function createNoConfig(): CanvasDeviceConfigSnapshot {
  return {
    kind: 'none',
  }
}

function createButtonConfig(activeLow = false): CanvasDeviceConfigSnapshot {
  return {
    kind: 'button',
    active_low: activeLow,
  }
}

function createSegmentDisplayConfig(digits: number, activeLow = false): CanvasDeviceConfigSnapshot {
  return {
    kind: 'segment_display',
    digits,
    active_low: activeLow,
  }
}

function createLedMatrixConfig(rows: number, columns: number): CanvasDeviceConfigSnapshot {
  return {
    kind: 'led_matrix',
    rows,
    columns,
  }
}

function defaultState(
  overrides: Partial<CanvasDeviceStateSnapshot> = {},
): CanvasDeviceStateSnapshot {
  return {
    is_on: false,
    color: null,
    binding: createSingleBinding(),
    config: createNoConfig(),
    ...overrides,
  }
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

function matrixBindingSlots(rows: number, columns: number): CanvasDeviceBindingSlot[] {
  return [
    ...Array.from({ length: rows }, (_, index) => ({
      key: `row-${index}`,
      label: translate('rowLabel', { index: index + 1 }),
    })),
    ...Array.from({ length: columns }, (_, index) => ({
      key: `col-${index}`,
      label: translate('columnLabel', { index: index + 1 }),
    })),
  ]
}

function normalizeMatrixDimension(value: number | null | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.round(value))
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

function normalizeSegmentDigitCount(value: number | null | undefined, fallback: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }

  return Math.max(1, Math.round(value))
}

export function isCanvasMatrixDevice(type: CanvasDeviceType): type is MatrixCanvasDeviceType {
  return type === 'led_matrix'
}

export function isCanvasSegmentDisplayDevice(
  type: CanvasDeviceType,
): type is SegmentCanvasDeviceType {
  return type === 'segment_display'
}

export function getCanvasMatrixDimensions(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasMatrixDimensions | null {
  if (!isCanvasMatrixDevice(device.type)) {
    return null
  }

  const defaults = defaultMatrixDimensionsForType()
  if (device.state.config.kind !== 'led_matrix') {
    return defaults
  }

  return {
    rows: normalizeMatrixDimension(device.state.config.rows, defaults.rows),
    columns: normalizeMatrixDimension(device.state.config.columns, defaults.columns),
  }
}

export function getCanvasSegmentDisplayConfig(
  device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>,
): CanvasSegmentDisplayConfig | null {
  if (!isCanvasSegmentDisplayDevice(device.type)) {
    return null
  }

  const defaults = defaultSegmentDisplayConfig()
  if (device.state.config.kind !== 'segment_display') {
    return defaults
  }

  return {
    digits: normalizeSegmentDigitCount(device.state.config.digits, defaults.digits),
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

export function resolveCanvasDeviceColor(device: Pick<CanvasDeviceSnapshot, 'type' | 'state'>) {
  const color = normalizeCanvasDeviceColor(device.state.color)
  if (color) {
    return color
  }

  if (device.type === 'led_matrix') {
    return CANVAS_DEVICE_PRESET_COLORS.green
  }

  if (device.type === 'led') {
    return CANVAS_DEVICE_PRESET_COLORS.red
  }

  return null
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

function createMatrixDeviceDefinition(
  title: string,
  dropAliases: string[],
): CanvasDeviceDefinition {
  const defaults = defaultMatrixDimensionsForType()

  return {
    title,
    dropAliases,
    defaultState: () =>
      defaultState({
        color: CANVAS_DEVICE_PRESET_COLORS.green,
        binding: createSlotBindings(
          Array.from({ length: defaults.rows + defaults.columns }, () => null),
        ),
        config: createLedMatrixConfig(defaults.rows, defaults.columns),
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
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
    getBindingSlots: (device) => {
      const dimensions = getCanvasMatrixDimensions(device) ?? defaults
      return matrixBindingSlots(dimensions.rows, dimensions.columns)
    },
  }
}

function createSegmentDisplayDefinition(): CanvasDeviceDefinition {
  const defaults = defaultSegmentDisplayConfig()

  return {
    title: translate('segmentDisplay'),
    dropAliases: ['segment_display', 'segmentdisplay'],
    defaultState: () =>
      defaultState({
        binding: createSlotBindings(Array.from({ length: 8 }, () => null)),
        config: createSegmentDisplayConfig(defaults.digits, defaults.activeLow),
      }),
    toRendererProps: (device) => {
      const config = getCanvasSegmentDisplayConfig(device) ?? defaults
      return {
        title:
          config.digits > 1
            ? `${config.digits}-${translate('segmentDisplay')}`
            : translate('segmentDisplay'),
        isOn: device.state.is_on,
        digits: config.digits,
      }
    },
    getShellSize: (device) => {
      const config = getCanvasSegmentDisplayConfig(device) ?? defaults
      return {
        width: alignShellSize(52 + config.digits * 42),
        height: 160,
      }
    },
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
    getBindingSlots: (device) => {
      const config = getCanvasSegmentDisplayConfig(device) ?? defaults
      return segmentBindingSlots(config.digits)
    },
  }
}

const canvasDeviceDefinitions: Record<CanvasDeviceType, CanvasDeviceDefinition> = {
  led: {
    title: translate('led'),
    dropAliases: ['led', 'bulb'],
    defaultState: () =>
      defaultState({
        color: CANVAS_DEVICE_PRESET_COLORS.red,
        binding: createSingleBinding(),
      }),
    toRendererProps: (device) => ({
      isOn: device.state.is_on,
      color: resolveCanvasDeviceColor(device) || undefined,
    }),
    getShellSize: () => ({
      width: 80,
      height: 100,
    }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
  },
  switch: {
    title: translate('switchDevice'),
    dropAliases: ['switch'],
    defaultState: () => defaultState({ binding: createSingleBinding() }),
    toRendererProps: (device) => ({
      isOn: device.state.is_on,
    }),
    getShellSize: () => ({
      width: 100,
      height: 160,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  button: {
    title: translate('button'),
    dropAliases: ['button'],
    defaultState: () =>
      defaultState({
        binding: createSingleBinding(),
        config: createButtonConfig(false),
      }),
    toRendererProps: (device) => ({
      isOn: device.state.is_on,
    }),
    getShellSize: () => ({
      width: 100,
      height: 100,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  keypad: {
    title: translate('keypad'),
    dropAliases: ['keypad'],
    defaultState: () => defaultState({ binding: createSingleBinding() }),
    toRendererProps: (device) => ({
      title: translate('keypad'),
      isOn: device.state.is_on,
      interactive: true,
      variant: 'keypad',
    }),
    getShellSize: () => ({
      width: 220,
      height: 320,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  small_keypad: {
    title: translate('smallKeypad'),
    dropAliases: ['small_keypad', 'smallkeypad'],
    defaultState: () => defaultState({ binding: createSingleBinding() }),
    toRendererProps: (device) => ({
      title: translate('smallKeypad'),
      isOn: device.state.is_on,
      interactive: true,
      variant: 'small_keypad',
    }),
    getShellSize: () => ({
      width: 180,
      height: 260,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  rotary_button: {
    title: translate('rotaryButton'),
    dropAliases: ['rotary_button', 'rotarybutton'],
    defaultState: () => defaultState({ binding: createSingleBinding() }),
    toRendererProps: (device) => ({
      title: translate('rotaryButton'),
      isOn: device.state.is_on,
      interactive: true,
      variant: 'rotary_button',
    }),
    getShellSize: () => ({
      width: 180,
      height: 240,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  ps2_keyboard: {
    title: translate('ps2Keyboard'),
    dropAliases: ['ps2_keyboard', 'ps2keyboard'],
    defaultState: () => defaultState({ binding: createSingleBinding() }),
    toRendererProps: (device) => ({
      title: translate('ps2Keyboard'),
      isOn: device.state.is_on,
      interactive: true,
      variant: 'ps2_keyboard',
    }),
    getShellSize: () => ({
      width: 280,
      height: 260,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  text_lcd: {
    title: translate('textLcd'),
    dropAliases: ['text_lcd', 'textlcd'],
    defaultState: () => defaultState({ binding: createSingleBinding() }),
    toRendererProps: (device) => ({
      title: translate('textLcd'),
      isOn: device.state.is_on,
      variant: 'text_lcd',
    }),
    getShellSize: () => ({
      width: 340,
      height: 240,
    }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
  },
  graphic_lcd: {
    title: translate('graphicLcd'),
    dropAliases: ['graphic_lcd', 'graphiclcd'],
    defaultState: () => defaultState({ binding: createSingleBinding() }),
    toRendererProps: (device) => ({
      title: translate('graphicLcd'),
      isOn: device.state.is_on,
      variant: 'graphic_lcd',
    }),
    getShellSize: () => ({
      width: 360,
      height: 280,
    }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
  },
  segment_display: createSegmentDisplayDefinition(),
  led_matrix: createMatrixDeviceDefinition(translate('matrix'), [
    'led_matrix',
    'ledmatrix',
    'matrix',
  ]),
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
