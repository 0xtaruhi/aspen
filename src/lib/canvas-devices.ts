import type {
  CanvasDeviceSnapshot,
  CanvasDeviceStateSnapshot,
  CanvasDeviceType,
} from '@/lib/hardware-client'

type CanvasDeviceCapabilities = {
  drivesSignal: boolean
  receivesSignal: boolean
}

type CanvasDeviceDefinition = {
  title: string
  dropAliases: string[]
  defaultState: () => CanvasDeviceStateSnapshot
  toRendererProps: (device: CanvasDeviceSnapshot) => Record<string, unknown>
  emitsToggle: boolean
  capabilities: CanvasDeviceCapabilities
}

const canvasDeviceDefinitions: Record<CanvasDeviceType, CanvasDeviceDefinition> = {
  led: {
    title: 'LED',
    dropAliases: ['led', 'bulb'],
    defaultState: () => ({
      is_on: false,
      color: 'red',
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      isOn: device.state.is_on,
      color: device.state.color || undefined,
    }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
  },
  switch: {
    title: 'Switch',
    dropAliases: ['switch'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      isOn: device.state.is_on,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  button: {
    title: 'Button',
    dropAliases: ['button'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      isOn: device.state.is_on,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  keypad: {
    title: 'Keypad',
    dropAliases: ['keypad'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      title: 'Keypad',
      isOn: device.state.is_on,
      interactive: true,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  small_keypad: {
    title: 'Small Keypad',
    dropAliases: ['small_keypad', 'smallkeypad'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      title: 'Small Keypad',
      isOn: device.state.is_on,
      interactive: true,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  rotary_button: {
    title: 'Rotary Button',
    dropAliases: ['rotary_button', 'rotarybutton'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      title: 'Rotary Button',
      isOn: device.state.is_on,
      interactive: true,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  ps2_keyboard: {
    title: 'PS/2 Keyboard',
    dropAliases: ['ps2_keyboard', 'ps2keyboard'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      title: 'PS/2 Keyboard',
      isOn: device.state.is_on,
      interactive: true,
    }),
    emitsToggle: true,
    capabilities: {
      drivesSignal: true,
      receivesSignal: false,
    },
  },
  text_lcd: {
    title: 'Text LCD',
    dropAliases: ['text_lcd', 'textlcd'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      title: 'Text LCD',
      isOn: device.state.is_on,
    }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
  },
  graphic_lcd: {
    title: 'Graphic LCD',
    dropAliases: ['graphic_lcd', 'graphiclcd'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      title: 'Graphic LCD',
      isOn: device.state.is_on,
    }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
  },
  segment_display: {
    title: 'Segment Display',
    dropAliases: ['segment_display', 'segmentdisplay'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      title: 'Segment Display',
      isOn: device.state.is_on,
    }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
  },
  four_digit_segment_display: {
    title: '4-Digit Segment',
    dropAliases: ['four_digit_segment_display', 'fourdigitsegmentdisplay'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      title: '4-Digit Segment',
      isOn: device.state.is_on,
    }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
  },
  led4x4_matrix: {
    title: 'LED 4x4 Matrix',
    dropAliases: ['led4x4_matrix', 'led4x4matrix'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      title: 'LED 4x4 Matrix',
      isOn: device.state.is_on,
    }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
  },
  led8x8_matrix: {
    title: 'LED 8x8 Matrix',
    dropAliases: ['led8x8_matrix', 'led8x8matrix'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      title: 'LED 8x8 Matrix',
      isOn: device.state.is_on,
    }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
  },
  led16x16_matrix: {
    title: 'LED 16x16 Matrix',
    dropAliases: ['led16x16_matrix', 'led16x16matrix'],
    defaultState: () => ({
      is_on: false,
      color: null,
      bound_signal: null,
    }),
    toRendererProps: (device) => ({
      title: 'LED 16x16 Matrix',
      isOn: device.state.is_on,
    }),
    emitsToggle: false,
    capabilities: {
      drivesSignal: false,
      receivesSignal: true,
    },
  },
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

export function canvasDeviceEmitsToggle(type: CanvasDeviceType): boolean {
  return getCanvasDeviceDefinition(type).emitsToggle
}

export function deviceDrivesSignal(type: CanvasDeviceType): boolean {
  return getCanvasDeviceDefinition(type).capabilities.drivesSignal
}

export function deviceReceivesSignal(type: CanvasDeviceType): boolean {
  return getCanvasDeviceDefinition(type).capabilities.receivesSignal
}
