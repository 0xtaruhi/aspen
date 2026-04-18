import type { Component } from 'vue'
import {
  Binary,
  CircleDot,
  Grid2x2,
  Lightbulb,
  MonitorSmartphone,
  Move3D,
  Rows3,
  ToggleLeft,
  Tv,
  Volume2,
  Waypoints,
} from 'lucide-vue-next'

import AudioPwmDevice from '@/components/devices/AudioPwmDevice.vue'
import ButtonDevice from '@/components/devices/ButtonDevice.vue'
import DipSwitchBankDevice from '@/components/devices/DipSwitchBankDevice.vue'
import Hd44780LcdDevice from '@/components/devices/Hd44780LcdDevice.vue'
import LedBarDevice from '@/components/devices/LedBarDevice.vue'
import LedDevice from '@/components/devices/LedDevice.vue'
import LedMatrixDevice from '@/components/devices/LedMatrixDevice.vue'
import MatrixKeypadDevice from '@/components/devices/MatrixKeypadDevice.vue'
import QuadratureEncoderDevice from '@/components/devices/QuadratureEncoderDevice.vue'
import SegmentDisplayDevice from '@/components/devices/SegmentDisplayDevice.vue'
import SwitchDevice from '@/components/devices/SwitchDevice.vue'
import UartTerminalDevice from '@/components/devices/UartTerminalDevice.vue'
import VgaDisplayDevice from '@/components/devices/VgaDisplayDevice.vue'
import DipSwitchBankBindingAssistant from '@/components/virtual-device/binding-assist/DipSwitchBankBindingAssistant.vue'
import LedBarBindingAssistant from '@/components/virtual-device/binding-assist/LedBarBindingAssistant.vue'
import MatrixKeypadBindingAssistant from '@/components/virtual-device/binding-assist/MatrixKeypadBindingAssistant.vue'
import SegmentDisplayBindingAssistant from '@/components/virtual-device/binding-assist/SegmentDisplayBindingAssistant.vue'
import LedMatrixBindingAssistant from '@/components/virtual-device/binding-assist/LedMatrixBindingAssistant.vue'
import VgaDisplayBindingAssistant from '@/components/virtual-device/binding-assist/VgaDisplayBindingAssistant.vue'
import DeviceButtonSettings from '@/components/virtual-device/settings/DeviceButtonSettings.vue'
import DeviceDipSwitchBankSettings from '@/components/virtual-device/settings/DeviceDipSwitchBankSettings.vue'
import DeviceHd44780LcdSettings from '@/components/virtual-device/settings/DeviceHd44780LcdSettings.vue'
import DeviceLedBarSettings from '@/components/virtual-device/settings/DeviceLedBarSettings.vue'
import DeviceLedMatrixSettings from '@/components/virtual-device/settings/DeviceLedMatrixSettings.vue'
import DeviceMatrixKeypadSettings from '@/components/virtual-device/settings/DeviceMatrixKeypadSettings.vue'
import DeviceQuadratureEncoderSettings from '@/components/virtual-device/settings/DeviceQuadratureEncoderSettings.vue'
import DeviceSegmentDisplaySettings from '@/components/virtual-device/settings/DeviceSegmentDisplaySettings.vue'
import DeviceUartTerminalSettings from '@/components/virtual-device/settings/DeviceUartTerminalSettings.vue'
import DeviceVgaDisplaySettings from '@/components/virtual-device/settings/DeviceVgaDisplaySettings.vue'
import {
  getCanvasDeviceBoundSignals,
  getCanvasDeviceTitle,
  getCanvasDeviceRendererProps,
  getCanvasHd44780LcdConfig,
  getCanvasLedBarConfig,
  getCanvasMatrixDimensions,
  getCanvasSegmentDisplayConfig,
  getCanvasVgaDisplayConfig,
} from '@/lib/canvas-devices'
import { translate, type MessageKey } from '@/lib/i18n'
import type {
  CanvasDeviceSnapshot,
  CanvasDeviceType,
  HardwareCanvasDeviceTelemetryEntry,
} from '@/lib/hardware-client'

export type CanvasDeviceGallerySectionId = 'input' | 'display' | 'debug'

type CanvasDeviceGalleryItem = {
  section: CanvasDeviceGallerySectionId
  order: number
  metaKey: MessageKey
  icon: Component
}

type CanvasDeviceRuntimeContext = {
  streamRunning: boolean
  telemetry: HardwareCanvasDeviceTelemetryEntry | undefined
  signalTelemetry: Record<string, { latest: boolean } | undefined>
  sampleRateHz: number
}

type CanvasDeviceActionContext = {
  toggleSwitch: (device: CanvasDeviceSnapshot, value: boolean) => void
  setBitsetValue: (device: CanvasDeviceSnapshot, index: number, value: boolean) => void
  rotateEncoder: (device: CanvasDeviceSnapshot, delta: number) => void
  setEncoderButton: (device: CanvasDeviceSnapshot, value: boolean) => void
  setMatrixKey: (device: CanvasDeviceSnapshot, row: number | null, column: number | null) => void
  enqueueAsciiText: (device: CanvasDeviceSnapshot, value: string) => void
}

export type CanvasDeviceUiDefinition = {
  renderer: Component
  gallery: CanvasDeviceGalleryItem
  supportsColor?: boolean
  settingsComponent?: Component
  bindingAssistantComponent?: Component
  buildRuntimeProps?: (
    device: CanvasDeviceSnapshot,
    context: CanvasDeviceRuntimeContext,
  ) => Record<string, unknown>
  buildRendererListeners?: (
    device: CanvasDeviceSnapshot,
    actions: CanvasDeviceActionContext,
  ) => CanvasDeviceRendererListeners | undefined
}

export type CanvasDeviceRendererListeners = Record<string, (...args: never[]) => void>

function getBitsetTelemetry(telemetry: HardwareCanvasDeviceTelemetryEntry | undefined) {
  return telemetry?.payload.kind === 'bitset' ? telemetry.payload.bits : null
}

function getAudioTelemetry(telemetry: HardwareCanvasDeviceTelemetryEntry | undefined) {
  return telemetry?.payload.kind === 'audio_pwm' ? telemetry.payload : null
}

function getTextLogTelemetry(telemetry: HardwareCanvasDeviceTelemetryEntry | undefined) {
  return telemetry?.payload.kind === 'text_log' ? telemetry.payload.log : null
}

function getTextLinesTelemetry(telemetry: HardwareCanvasDeviceTelemetryEntry | undefined) {
  return telemetry?.payload.kind === 'text_lines' ? telemetry.payload.lines : null
}

function getFramebufferTelemetry(telemetry: HardwareCanvasDeviceTelemetryEntry | undefined) {
  return telemetry?.payload.kind === 'framebuffer' ? telemetry.payload : null
}

function getSegmentTelemetry(telemetry: HardwareCanvasDeviceTelemetryEntry | undefined) {
  return telemetry?.payload.kind === 'segment_display' ? telemetry.payload : null
}

const canvasDeviceUiDefinitions: Record<CanvasDeviceType, CanvasDeviceUiDefinition> = {
  led: {
    renderer: LedDevice,
    gallery: { section: 'display', order: 10, metaKey: 'galleryMetaOneBitOutput', icon: Lightbulb },
    supportsColor: true,
  },
  switch: {
    renderer: SwitchDevice,
    gallery: { section: 'input', order: 10, metaKey: 'galleryMetaOneBitInput', icon: ToggleLeft },
  },
  button: {
    renderer: ButtonDevice,
    gallery: { section: 'input', order: 20, metaKey: 'galleryMetaMomentaryInput', icon: CircleDot },
    settingsComponent: DeviceButtonSettings,
  },
  dip_switch_bank: {
    renderer: DipSwitchBankDevice,
    gallery: { section: 'input', order: 30, metaKey: 'galleryMetaBankedInput', icon: Rows3 },
    settingsComponent: DeviceDipSwitchBankSettings,
    bindingAssistantComponent: DipSwitchBankBindingAssistant,
    buildRendererListeners: (device, actions) => ({
      'toggle-bit': (index: number, value: boolean) => {
        actions.setBitsetValue(device, index, value)
      },
    }),
  },
  led_bar: {
    renderer: LedBarDevice,
    gallery: { section: 'display', order: 20, metaKey: 'galleryMetaBusMonitor', icon: Rows3 },
    supportsColor: true,
    settingsComponent: DeviceLedBarSettings,
    bindingAssistantComponent: LedBarBindingAssistant,
    buildRuntimeProps: (device, context) => {
      const config = getCanvasLedBarConfig(device)
      if (!context.streamRunning) {
        return {
          bits: Array.from({ length: config?.width ?? 8 }, () => false),
        }
      }

      const telemetryBits =
        getBitsetTelemetry(context.telemetry)?.map((value) => Boolean(value)) ?? null
      const fallbackBits = getCanvasDeviceBoundSignals(device).map((signal) => {
        if (!signal) {
          return false
        }
        const rawLevel = context.signalTelemetry[signal]?.latest ?? false
        return config?.activeLow ? !rawLevel : rawLevel
      })

      return {
        bits: telemetryBits ?? fallbackBits,
      }
    },
  },
  audio_pwm: {
    renderer: AudioPwmDevice,
    gallery: { section: 'display', order: 30, metaKey: 'galleryMetaToneMonitor', icon: Volume2 },
    buildRuntimeProps: (_device, context) => {
      const audioTelemetry = getAudioTelemetry(context.telemetry)
      const periodSamples = audioTelemetry?.period_samples ?? 0
      const frequencyHz =
        context.streamRunning && context.sampleRateHz > 0 && periodSamples > 0
          ? context.sampleRateHz / periodSamples
          : 0

      return {
        frequencyHz,
        dutyRatio: context.telemetry?.high_ratio ?? 0,
        sampleRateHz: context.sampleRateHz,
        edgeCount: audioTelemetry?.edge_count ?? 0,
        isOn: context.telemetry?.latest ?? false,
      }
    },
  },
  quadrature_encoder: {
    renderer: QuadratureEncoderDevice,
    gallery: { section: 'input', order: 40, metaKey: 'galleryMetaEncoder', icon: Move3D },
    settingsComponent: DeviceQuadratureEncoderSettings,
    buildRendererListeners: (device, actions) => ({
      rotate: (delta: number) => {
        actions.rotateEncoder(device, delta)
      },
      'toggle-button': (value: boolean) => {
        actions.setEncoderButton(device, value)
      },
    }),
  },
  matrix_keypad: {
    renderer: MatrixKeypadDevice,
    gallery: { section: 'input', order: 50, metaKey: 'galleryMetaRowColumnScan', icon: Grid2x2 },
    settingsComponent: DeviceMatrixKeypadSettings,
    bindingAssistantComponent: MatrixKeypadBindingAssistant,
    buildRendererListeners: (device, actions) => ({
      'press-key': (row: number | null, column: number | null) => {
        actions.setMatrixKey(device, row, column)
      },
    }),
  },
  uart_terminal: {
    renderer: UartTerminalDevice,
    gallery: { section: 'debug', order: 10, metaKey: 'galleryMetaSerialConsole', icon: Waypoints },
    settingsComponent: DeviceUartTerminalSettings,
    buildRuntimeProps: (_device, context) => ({
      textLog: getTextLogTelemetry(context.telemetry) ?? '',
    }),
    buildRendererListeners: (device, actions) => ({
      'queue-text': (value: string) => {
        actions.enqueueAsciiText(device, value)
      },
    }),
  },
  hd44780_lcd: {
    renderer: Hd44780LcdDevice,
    gallery: {
      section: 'display',
      order: 50,
      metaKey: 'galleryMetaCharacterLcd',
      icon: MonitorSmartphone,
    },
    settingsComponent: DeviceHd44780LcdSettings,
    buildRuntimeProps: (device, context) => ({
      lines:
        getTextLinesTelemetry(context.telemetry) ??
        Array.from({ length: getCanvasHd44780LcdConfig(device)?.rows ?? 2 }, () => ''),
    }),
  },
  vga_display: {
    renderer: VgaDisplayDevice,
    gallery: { section: 'display', order: 70, metaKey: 'galleryMetaRasterDisplay', icon: Tv },
    settingsComponent: DeviceVgaDisplaySettings,
    bindingAssistantComponent: VgaDisplayBindingAssistant,
    buildRuntimeProps: (device, context) => {
      const config = getCanvasVgaDisplayConfig(device)
      const framebufferTelemetry = getFramebufferTelemetry(context.telemetry)
      return {
        isOn: context.streamRunning ? Boolean(context.telemetry?.latest) : false,
        columns: framebufferTelemetry?.columns || config?.columns || 320,
        rows: framebufferTelemetry?.rows || config?.rows || 240,
        pixels: context.streamRunning ? (framebufferTelemetry?.pixels ?? []) : [],
      }
    },
  },
  segment_display: {
    renderer: SegmentDisplayDevice,
    gallery: { section: 'display', order: 40, metaKey: 'galleryMetaSevenSegOutput', icon: Binary },
    settingsComponent: DeviceSegmentDisplaySettings,
    bindingAssistantComponent: SegmentDisplayBindingAssistant,
    buildRuntimeProps: (device, context) => {
      const config = getCanvasSegmentDisplayConfig(device)
      const digits = config?.digits || 1
      const segmentTelemetry = getSegmentTelemetry(context.telemetry)
      return {
        digitSegmentMasks: context.streamRunning
          ? (segmentTelemetry?.digit_segment_masks ??
            Array.from({ length: digits }, (_, index) => {
              return index === 0 ? (segmentTelemetry?.segment_mask ?? 0) : 0
            }))
          : Array.from({ length: digits }, () => 0),
        segmentMask: context.streamRunning ? (segmentTelemetry?.segment_mask ?? 0) : 0,
      }
    },
  },
  led_matrix: {
    renderer: LedMatrixDevice,
    gallery: { section: 'display', order: 45, metaKey: 'galleryMetaScannedDisplay', icon: Grid2x2 },
    supportsColor: true,
    settingsComponent: DeviceLedMatrixSettings,
    bindingAssistantComponent: LedMatrixBindingAssistant,
    buildRuntimeProps: (device, context) => {
      const dimensions = getCanvasMatrixDimensions(device)
      const framebufferTelemetry = getFramebufferTelemetry(context.telemetry)
      return {
        columns: framebufferTelemetry?.columns || dimensions?.columns || 8,
        rows: framebufferTelemetry?.rows || dimensions?.rows || 8,
        pixels: context.streamRunning ? (framebufferTelemetry?.pixels ?? []) : [],
      }
    },
  },
}

const gallerySectionOrder: Array<{
  id: CanvasDeviceGallerySectionId
  titleKey: 'inputDevices' | 'displayDevices' | 'debugDevices'
}> = [
  { id: 'input', titleKey: 'inputDevices' },
  { id: 'display', titleKey: 'displayDevices' },
  { id: 'debug', titleKey: 'debugDevices' },
]

export function getCanvasDeviceUiDefinition(type: CanvasDeviceType) {
  return canvasDeviceUiDefinitions[type]
}

export function getCanvasDeviceRenderer(type: CanvasDeviceType) {
  return getCanvasDeviceUiDefinition(type).renderer
}

export function getCanvasDeviceSettingsComponent(type: CanvasDeviceType) {
  return getCanvasDeviceUiDefinition(type).settingsComponent ?? null
}

export function getCanvasDeviceBindingAssistantComponent(type: CanvasDeviceType) {
  return getCanvasDeviceUiDefinition(type).bindingAssistantComponent ?? null
}

export function canvasDeviceSupportsColor(type: CanvasDeviceType) {
  return Boolean(getCanvasDeviceUiDefinition(type).supportsColor)
}

export function getCanvasDeviceDisplayTitle(type: CanvasDeviceType) {
  return getCanvasDeviceTitle(type)
}

export function listCanvasDeviceGallerySections() {
  return gallerySectionOrder
    .map((section) => {
      const items = (Object.keys(canvasDeviceUiDefinitions) as CanvasDeviceType[])
        .filter((type) => getCanvasDeviceUiDefinition(type).gallery.section === section.id)
        .sort((left, right) => {
          return (
            getCanvasDeviceUiDefinition(left).gallery.order -
            getCanvasDeviceUiDefinition(right).gallery.order
          )
        })
        .map((type) => ({
          type,
          title: getCanvasDeviceDisplayTitle(type),
          meta: translate(getCanvasDeviceUiDefinition(type).gallery.metaKey),
          icon: getCanvasDeviceUiDefinition(type).gallery.icon,
        }))

      return {
        id: section.id,
        titleKey: section.titleKey,
        items,
      }
    })
    .filter((section) => section.items.length > 0)
}

export function buildCanvasDeviceRendererProps(
  device: CanvasDeviceSnapshot,
  context: CanvasDeviceRuntimeContext,
) {
  const definition = getCanvasDeviceUiDefinition(device.type)
  return {
    ...getCanvasDeviceRendererProps(device),
    ...(definition.buildRuntimeProps?.(device, context) ?? {}),
  }
}

export function buildCanvasDeviceRendererListeners(
  device: CanvasDeviceSnapshot,
  actions: CanvasDeviceActionContext,
) {
  return getCanvasDeviceUiDefinition(device.type).buildRendererListeners?.(device, actions)
}
