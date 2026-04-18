import type { CanvasDeviceSnapshot, CanvasDeviceType } from './hardware-client'
import type {
  CanvasDeviceBindingSlot,
  CanvasDeviceDefinition,
  CanvasDeviceShellSize,
} from './canvas-device-types'
import type { SupportedLanguage } from './i18n'

import { alignShellSize, measureMatrixShellSize } from './device-shell-metrics'
import {
  CANVAS_DEVICE_PRESET_COLORS,
  createBitset,
  createBusSlots,
  createDefaultState,
  createMatrixSlots,
  createSingleBinding,
  createSlotBindings,
  defaultDipSwitchBankConfig,
  defaultHd44780Config,
  defaultLedBarConfig,
  defaultMatrixDimensions,
  defaultMatrixKeypadConfig,
  defaultQuadratureEncoderConfig,
  defaultSegmentDisplayConfig,
  defaultUartTerminalConfig,
  defaultVgaDisplayConfig,
  getCanvasBitsetData,
  getCanvasDipSwitchBankConfig,
  getCanvasHd44780LcdConfig,
  getCanvasLedBarConfig,
  getCanvasMatrixDimensions,
  getCanvasMatrixKeypadConfig,
  getCanvasMatrixKeypadData,
  getCanvasQuadratureEncoderConfig,
  getCanvasQuadratureEncoderData,
  getCanvasSegmentDisplayConfig,
  getCanvasUartTerminalConfig,
  getCanvasVgaDisplayConfig,
  hd44780BindingSlots,
  resolveCanvasDeviceColor,
  segmentBindingSlots,
  uartBindingSlots,
  vgaBindingSlots,
} from './canvas-device-config'
import { translate, translateWithLanguage } from './i18n'

function createMatrixDeviceDefinition(
  titleKey: CanvasDeviceDefinition['titleKey'],
  aliases: readonly string[],
): CanvasDeviceDefinition {
  const defaults = defaultMatrixDimensions()

  return {
    titleKey,
    aliases,
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
      return createMatrixSlots(dimensions.rows, dimensions.columns)
    },
  }
}

function createSegmentDisplayDefinition(): CanvasDeviceDefinition {
  const defaults = defaultSegmentDisplayConfig()
  const getConfig = (device: CanvasDeviceSnapshot) => {
    return getCanvasSegmentDisplayConfig(device) ?? defaults
  }

  return {
    titleKey: 'segmentDisplay',
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
      const config = getConfig(device)
      return { digits: config.digits, isOn: device.state.is_on }
    },
    getShellSize: (device) => {
      const config = getConfig(device)
      return { width: alignShellSize(52 + config.digits * 42), height: 160 }
    },
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
    getBindingSlots: (device) => segmentBindingSlots(getConfig(device).digits),
  }
}

function createVgaDisplayDefinition(): CanvasDeviceDefinition {
  const defaults = defaultVgaDisplayConfig()
  const getConfig = (device: CanvasDeviceSnapshot) => {
    return getCanvasVgaDisplayConfig(device) ?? defaults
  }

  return {
    titleKey: 'vgaDisplay',
    aliases: ['vga'],
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
    toRendererProps: (device) => {
      const config = getConfig(device)
      return {
        isOn: device.state.is_on,
        columns: config.columns,
        rows: config.rows,
      }
    },
    getShellSize: () => ({ width: alignShellSize(420), height: alignShellSize(320) }),
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
    getBindingSlots: (device) => vgaBindingSlots(getConfig(device).colorMode),
  }
}

function createDipSwitchBankDefinition(): CanvasDeviceDefinition {
  const defaults = defaultDipSwitchBankConfig()
  const getConfig = (device: CanvasDeviceSnapshot) => {
    return getCanvasDipSwitchBankConfig(device) ?? defaults
  }

  return {
    titleKey: 'dipSwitchBank',
    aliases: ['dip'],
    defaultState: () =>
      createDefaultState({
        binding: createSlotBindings(Array.from({ length: defaults.width }, () => null)),
        config: { kind: 'dip_switch_bank', width: defaults.width },
        data: { kind: 'bitset', bits: createBitset(defaults.width) },
      }),
    toRendererProps: (device) => {
      const config = getConfig(device)
      return { width: config.width, bits: getCanvasBitsetData(device, config.width) }
    },
    getShellSize: (device) => {
      const config = getConfig(device)
      return { width: alignShellSize(48 + config.width * 28), height: 140 }
    },
    emitsToggle: false,
    capabilities: { drivesSignal: true, receivesSignal: false },
    projectPersistence: { persistData: true },
    getBindingSlots: (device) => createBusSlots('SW', getConfig(device).width),
  }
}

function createLedBarDefinition(): CanvasDeviceDefinition {
  const defaults = defaultLedBarConfig()
  const getConfig = (device: CanvasDeviceSnapshot) => {
    return getCanvasLedBarConfig(device) ?? defaults
  }

  return {
    titleKey: 'ledBar',
    defaultState: () =>
      createDefaultState({
        color: CANVAS_DEVICE_PRESET_COLORS.green,
        binding: createSlotBindings(Array.from({ length: defaults.width }, () => null)),
        config: { kind: 'led_bar', width: defaults.width, active_low: defaults.activeLow },
      }),
    toRendererProps: (device) => {
      const config = getConfig(device)
      return {
        width: config.width,
        activeLow: config.activeLow,
        color: resolveCanvasDeviceColor(device) ?? CANVAS_DEVICE_PRESET_COLORS.green,
      }
    },
    getShellSize: (device) => {
      const config = getConfig(device)
      return { width: alignShellSize(48 + config.width * 24), height: 120 }
    },
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
    getBindingSlots: (device) => createBusSlots('LED', getConfig(device).width),
  }
}

function createQuadratureEncoderDefinition(): CanvasDeviceDefinition {
  const defaults = defaultQuadratureEncoderConfig()
  const getConfig = (device: CanvasDeviceSnapshot) => {
    return getCanvasQuadratureEncoderConfig(device) ?? defaults
  }

  return {
    titleKey: 'quadratureEncoder',
    aliases: ['encoder'],
    defaultState: () =>
      createDefaultState({
        binding: createSlotBindings(Array.from({ length: defaults.hasButton ? 3 : 2 }, () => null)),
        config: { kind: 'quadrature_encoder', has_button: defaults.hasButton },
        data: { kind: 'quadrature_encoder', phase: 0, button_pressed: false },
      }),
    toRendererProps: (device) => {
      const config = getConfig(device)
      const data = getCanvasQuadratureEncoderData(device)
      return { hasButton: config.hasButton, phase: data.phase, buttonPressed: data.buttonPressed }
    },
    getShellSize: () => ({ width: 200, height: 180 }),
    emitsToggle: false,
    capabilities: { drivesSignal: true, receivesSignal: false },
    getBindingSlots: (device) => {
      const config = getConfig(device)
      return [
        { key: 'a', label: 'A' },
        { key: 'b', label: 'B' },
        ...(config.hasButton ? [{ key: 'sw', label: 'SW' }] : []),
      ]
    },
  }
}

function createMatrixKeypadDefinition(): CanvasDeviceDefinition {
  const defaults = defaultMatrixKeypadConfig()
  const getConfig = (device: CanvasDeviceSnapshot) => {
    return getCanvasMatrixKeypadConfig(device) ?? defaults
  }

  return {
    titleKey: 'matrixKeypad',
    defaultState: () =>
      createDefaultState({
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
      }),
    toRendererProps: (device) => {
      const config = getConfig(device)
      const data = getCanvasMatrixKeypadData(device)
      return {
        rows: config.rows,
        columns: config.columns,
        pressedRow: data.pressedRow,
        pressedColumn: data.pressedColumn,
      }
    },
    getShellSize: (device) => {
      const config = getConfig(device)
      return {
        width: alignShellSize(36 + config.columns * 40),
        height: alignShellSize(44 + config.rows * 40),
      }
    },
    emitsToggle: false,
    capabilities: { drivesSignal: true, receivesSignal: true },
    getBindingSlots: (device) => {
      const config = getConfig(device)
      return createMatrixSlots(config.rows, config.columns)
    },
  }
}

function createUartTerminalDefinition(): CanvasDeviceDefinition {
  const defaults = defaultUartTerminalConfig()
  const getConfig = (device: CanvasDeviceSnapshot) => {
    return getCanvasUartTerminalConfig(device) ?? defaults
  }

  return {
    titleKey: 'uartTerminal',
    aliases: ['uart'],
    defaultState: () =>
      createDefaultState({
        binding: createSlotBindings(
          Array.from({ length: uartBindingSlots(defaults.mode).length }, () => null),
        ),
        config: {
          kind: 'uart_terminal',
          cycles_per_bit: defaults.cyclesPerBit,
          mode: defaults.mode,
        },
        data: { kind: 'queued_bytes', bytes: [] },
      }),
    toRendererProps: () => ({}),
    getShellSize: () => ({ width: 360, height: 260 }),
    emitsToggle: false,
    capabilities: { drivesSignal: true, receivesSignal: true },
    getBindingSlots: (device) => uartBindingSlots(getConfig(device).mode),
  }
}

function createHd44780Definition(): CanvasDeviceDefinition {
  const defaults = defaultHd44780Config()
  const getConfig = (device: CanvasDeviceSnapshot) => {
    return getCanvasHd44780LcdConfig(device) ?? defaults
  }

  return {
    titleKey: 'hd44780Lcd',
    aliases: ['lcd'],
    defaultState: () =>
      createDefaultState({
        binding: createSlotBindings(
          Array.from({ length: hd44780BindingSlots(defaults.busMode).length }, () => null),
        ),
        config: {
          kind: 'hd44780_lcd',
          columns: defaults.columns,
          rows: defaults.rows,
          bus_mode: defaults.busMode,
        },
      }),
    toRendererProps: (device) => {
      const config = getConfig(device)
      return { columns: config.columns, rows: config.rows, busMode: config.busMode }
    },
    getShellSize: (device) => {
      const config = getConfig(device)
      return {
        width: alignShellSize(150 + config.columns * 11),
        height: alignShellSize(86 + config.rows * 24),
      }
    },
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
    getBindingSlots: (device) => hd44780BindingSlots(getConfig(device).busMode),
  }
}

const canvasDeviceDefinitions: Record<CanvasDeviceType, CanvasDeviceDefinition> = {
  led: {
    titleKey: 'led',
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
    titleKey: 'switchDevice',
    defaultState: () => createDefaultState({ binding: createSingleBinding() }),
    toRendererProps: (device) => ({ isOn: device.state.is_on }),
    getShellSize: () => ({ width: 100, height: 160 }),
    emitsToggle: true,
    capabilities: { drivesSignal: true, receivesSignal: false },
    projectPersistence: { persistIsOn: true },
  },
  button: {
    titleKey: 'button',
    defaultState: () =>
      createDefaultState({
        binding: createSingleBinding(),
        config: { kind: 'button', active_low: false },
      }),
    toRendererProps: (device) => ({ isOn: device.state.is_on }),
    getShellSize: () => ({ width: 100, height: 120 }),
    emitsToggle: true,
    capabilities: { drivesSignal: true, receivesSignal: false },
  },
  dip_switch_bank: createDipSwitchBankDefinition(),
  led_bar: createLedBarDefinition(),
  quadrature_encoder: createQuadratureEncoderDefinition(),
  audio_pwm: {
    titleKey: 'audioPwm',
    aliases: ['audio', 'buzzer'],
    defaultState: () => createDefaultState({ binding: createSingleBinding() }),
    toRendererProps: () => ({}),
    getShellSize: () => ({ width: 260, height: 160 }),
    emitsToggle: false,
    capabilities: { drivesSignal: false, receivesSignal: true },
  },
  matrix_keypad: createMatrixKeypadDefinition(),
  uart_terminal: createUartTerminalDefinition(),
  hd44780_lcd: createHd44780Definition(),
  vga_display: createVgaDisplayDefinition(),
  segment_display: createSegmentDisplayDefinition(),
  led_matrix: createMatrixDeviceDefinition('matrix', ['matrix']),
}

function getCanvasDeviceDefinition(type: CanvasDeviceType): CanvasDeviceDefinition {
  return canvasDeviceDefinitions[type]
}

const aliasToType = new Map<string, CanvasDeviceType>(
  Object.entries(canvasDeviceDefinitions).flatMap(([type, definition]) => {
    return [type, ...(definition.aliases ?? [])].map((alias) => [alias, type as CanvasDeviceType])
  }),
)

export function resolveCanvasDeviceType(rawType?: string): CanvasDeviceType | null {
  if (!rawType) {
    return null
  }

  return aliasToType.get(rawType.toLowerCase()) ?? null
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
    label: `${translate(definition.titleKey)} ${index}`,
    state: definition.defaultState(),
  }
}

export function getCanvasDeviceTitle(type: CanvasDeviceType, language?: SupportedLanguage) {
  const { titleKey } = getCanvasDeviceDefinition(type)
  return language ? translateWithLanguage(language, titleKey) : translate(titleKey)
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

export function sanitizeCanvasDeviceSnapshotForProject(
  device: CanvasDeviceSnapshot,
): CanvasDeviceSnapshot {
  const cloned = JSON.parse(JSON.stringify(device)) as CanvasDeviceSnapshot
  const persistence = getCanvasDeviceDefinition(cloned.type).projectPersistence

  if (!persistence?.persistIsOn) {
    cloned.state.is_on = false
  }

  if (!persistence?.persistData) {
    cloned.state.data = { kind: 'none' }
  }

  return cloned
}
