<script setup lang="ts">
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import type {
  CanvasDeviceSnapshot,
  CanvasHd44780BusMode,
  CanvasMemoryMode,
  CanvasVgaColorMode,
} from '@/lib/hardware-client'
import { loadHardwareMemoryImage } from '@/lib/hardware-client'
import type { SignalCatalogEntry } from '@/stores/signal-catalog'

import { computed, ref, watch } from 'vue'
import { Link2, Trash2, Unplug, X } from 'lucide-vue-next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import {
  CANVAS_MEMORY_MAX_ADDRESS_WIDTH,
  CANVAS_MEMORY_PREVIEW_WORDS,
  CANVAS_DEVICE_PRESET_COLORS,
  VGA_DISPLAY_RESOLUTION_PRESETS,
  deviceDrivesSignal,
  deviceReceivesSignal,
  getCanvasBitsetData,
  getCanvasButtonConfig,
  getCanvasDeviceBindingSlots,
  getCanvasDipSwitchBankConfig,
  getCanvasHd44780LcdConfig,
  getCanvasLedBarConfig,
  getCanvasMatrixDimensions,
  getCanvasMatrixKeypadConfig,
  getCanvasMemoryConfig,
  getCanvasMemoryData,
  getCanvasMemoryWordsData,
  getCanvasQuadratureEncoderConfig,
  getCanvasSegmentDisplayConfig,
  getCanvasUartTerminalConfig,
  getCanvasVgaDisplayConfig,
  normalizeCanvasDeviceColor,
  resolveCanvasDeviceColor,
  vgaColorModeBitCounts,
} from '@/lib/canvas-devices'
import { confirmAction } from '@/lib/confirm-action'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import { settingsStore } from '@/stores/settings'
import { signalCatalogStore } from '@/stores/signal-catalog'

type IndexedSignalBus = {
  baseName: string
  label: string
  width: number
  signals: Array<string | null>
}

const props = defineProps<{
  device: CanvasDeviceSnapshot | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const UNBOUND_SIGNAL = '__unbound__'

const { t } = useI18n()

const nameInput = ref('')
const colorInput = ref(CANVAS_DEVICE_PRESET_COLORS.red)
const numericInputs = ref<Record<string, string>>({})
const matrixRowBusInput = ref('')
const matrixColumnBusInput = ref('')
const segmentBusInput = ref('')
const segmentDigitBusInput = ref('')

const compatibleSignals = computed<readonly SignalCatalogEntry[]>(() => {
  if (!props.device) {
    return []
  }

  const drives = deviceDrivesSignal(props.device.type)
  const receives = deviceReceivesSignal(props.device.type)

  return signalCatalogStore.signals.value.filter((signal) => {
    if (drives && !receives) {
      return signal.direction === 'input' || signal.direction === 'inout'
    }

    if (receives && !drives) {
      return signal.direction === 'output' || signal.direction === 'inout'
    }

    return true
  })
})

const indexedCompatibleBuses = computed<IndexedSignalBus[]>(() => {
  const buses = new Map<
    string,
    {
      maxIndex: number
      signals: Map<number, string>
    }
  >()

  for (const signal of compatibleSignals.value) {
    const match = signal.name.match(/^(.*)\[(\d+)\]$/)
    if (!match) {
      continue
    }

    const baseName = match[1]
    const bitIndex = Number.parseInt(match[2], 10)
    if (Number.isNaN(bitIndex)) {
      continue
    }

    const existing = buses.get(baseName) ?? {
      maxIndex: -1,
      signals: new Map<number, string>(),
    }
    existing.maxIndex = Math.max(existing.maxIndex, bitIndex)
    existing.signals.set(bitIndex, signal.name)
    buses.set(baseName, existing)
  }

  return [...buses.entries()]
    .map(([baseName, bus]) => {
      const width = bus.maxIndex + 1
      return {
        baseName,
        label: `${baseName}[0:${width - 1}]`,
        width,
        signals: Array.from({ length: width }, (_, index) => bus.signals.get(index) ?? null),
      }
    })
    .sort((left, right) => left.baseName.localeCompare(right.baseName))
})

const bindingSlots = computed(() => {
  if (!props.device) {
    return []
  }

  return getCanvasDeviceBindingSlots(props.device)
})

const matrixDimensions = computed(() => {
  if (!props.device || props.device.type !== 'led_matrix') {
    return null
  }

  return getCanvasMatrixDimensions(props.device)
})

const segmentDisplayConfig = computed(() => {
  if (!props.device || props.device.type !== 'segment_display') {
    return null
  }

  return getCanvasSegmentDisplayConfig(props.device)
})

const matrixRowBusOptions = computed(() => {
  const rows = matrixDimensions.value?.rows ?? 0
  return indexedCompatibleBuses.value.filter((bus) => bus.width >= rows)
})

const matrixColumnBusOptions = computed(() => {
  const columns = matrixDimensions.value?.columns ?? 0
  return indexedCompatibleBuses.value.filter((bus) => bus.width >= columns)
})

const segmentBusOptions = computed(() => {
  return indexedCompatibleBuses.value.filter((bus) => bus.width >= 8)
})

const segmentDigitBusOptions = computed(() => {
  const digits = segmentDisplayConfig.value?.digits ?? 0
  return indexedCompatibleBuses.value.filter((bus) => bus.width >= digits)
})

const liveLevel = computed(() => {
  if (!props.device || !hardwareStore.dataStreamStatus.value.running) {
    return false
  }

  const telemetry = hardwareStore.deviceTelemetry.value[props.device.id]
  if (telemetry) {
    return telemetry.latest
  }

  return false
})

const capabilityLabel = computed(() => {
  if (!props.device) {
    return ''
  }

  const drives = deviceDrivesSignal(props.device.type)
  const receives = deviceReceivesSignal(props.device.type)

  if (drives && receives) return t('bidirectionalDevice')
  if (drives) return t('drivesFpgaInput')
  return t('observesFpgaOutput')
})

const memoryPreviewRows = computed(() => {
  if (!props.device || props.device.type !== 'memory') {
    return []
  }

  const config = getCanvasMemoryConfig(props.device)
  const wordCount = 1 << Math.min(config?.addressWidth ?? 8, CANVAS_MEMORY_MAX_ADDRESS_WIDTH)
  const data = getCanvasMemoryData(props.device, wordCount)
  const maxOffset = Math.max(0, wordCount - 1)
  const previewOffset = clampInt(
    numericInputs.value.memoryPreviewOffset,
    data.previewOffset,
    0,
    maxOffset,
  )
  const telemetry = hardwareStore.deviceTelemetry.value[props.device.id]
  const liveWords =
    hardwareStore.dataStreamStatus.value.running &&
    telemetry?.sample_values?.length &&
    telemetry.memory_preview_start === previewOffset
      ? telemetry.sample_values
      : null
  const sourceWords =
    liveWords ?? data.words.slice(previewOffset, previewOffset + CANVAS_MEMORY_PREVIEW_WORDS)

  return sourceWords.map((value, localIndex) => ({
    index: previewOffset + localIndex,
    value,
  }))
})

const memorySourceLabel = computed(() => {
  if (!props.device || props.device.type !== 'memory') {
    return null
  }

  return basenameFromPath(getCanvasMemoryData(props.device).sourcePath)
})

watch(
  () => props.device,
  (device) => {
    nameInput.value = device?.label ?? ''
    colorInput.value = device
      ? (resolveCanvasDeviceColor(device) ?? CANVAS_DEVICE_PRESET_COLORS.red)
      : CANVAS_DEVICE_PRESET_COLORS.red

    numericInputs.value = {
      ledMatrixRows: String(
        getCanvasMatrixDimensions(device ?? fallbackDevice('led_matrix'))?.rows ?? 8,
      ),
      ledMatrixColumns: String(
        getCanvasMatrixDimensions(device ?? fallbackDevice('led_matrix'))?.columns ?? 8,
      ),
      segmentDigits: String(
        getCanvasSegmentDisplayConfig(device ?? fallbackDevice('segment_display'))?.digits ?? 1,
      ),
      dipWidth: String(
        getCanvasDipSwitchBankConfig(device ?? fallbackDevice('dip_switch_bank'))?.width ?? 8,
      ),
      ledBarWidth: String(getCanvasLedBarConfig(device ?? fallbackDevice('led_bar'))?.width ?? 8),
      keypadRows: String(
        getCanvasMatrixKeypadConfig(device ?? fallbackDevice('matrix_keypad'))?.rows ?? 4,
      ),
      keypadColumns: String(
        getCanvasMatrixKeypadConfig(device ?? fallbackDevice('matrix_keypad'))?.columns ?? 4,
      ),
      uartCycles: String(
        getCanvasUartTerminalConfig(device ?? fallbackDevice('uart_terminal'))?.cyclesPerBit ?? 16,
      ),
      lcdColumns: String(
        getCanvasHd44780LcdConfig(device ?? fallbackDevice('hd44780_lcd'))?.columns ?? 16,
      ),
      lcdRows: String(
        getCanvasHd44780LcdConfig(device ?? fallbackDevice('hd44780_lcd'))?.rows ?? 2,
      ),
      memoryAddressWidth: String(
        getCanvasMemoryConfig(device ?? fallbackDevice('memory'))?.addressWidth ?? 8,
      ),
      memoryDataWidth: String(
        getCanvasMemoryConfig(device ?? fallbackDevice('memory'))?.dataWidth ?? 8,
      ),
      memoryPreviewOffset: String(
        getCanvasMemoryData(device ?? fallbackDevice('memory')).previewOffset ?? 0,
      ),
    }
  },
  { immediate: true },
)

watch(
  () => {
    const device = props.device
    return {
      id: device?.id ?? null,
      type: device?.type ?? null,
      rows: matrixDimensions.value?.rows ?? null,
      columns: matrixDimensions.value?.columns ?? null,
      digits: segmentDisplayConfig.value?.digits ?? null,
      indexedBuses: indexedCompatibleBuses.value
        .map((bus) => `${bus.baseName}:${bus.width}`)
        .join('|'),
    }
  },
  () => {
    if (matrixDimensions.value) {
      matrixRowBusInput.value = guessIndexedBus(matrixDimensions.value.rows, ['row'])
      matrixColumnBusInput.value = guessIndexedBus(
        matrixDimensions.value.columns,
        ['info', 'col', 'column'],
        matrixRowBusInput.value,
      )
    } else {
      matrixRowBusInput.value = ''
      matrixColumnBusInput.value = ''
    }

    if (segmentDisplayConfig.value) {
      segmentBusInput.value = guessIndexedBus(8, ['segment', 'seg'])
      segmentDigitBusInput.value =
        segmentDisplayConfig.value.digits > 1
          ? guessIndexedBus(
              segmentDisplayConfig.value.digits,
              ['sel', 'digit'],
              segmentBusInput.value,
            )
          : ''
    } else {
      segmentBusInput.value = ''
      segmentDigitBusInput.value = ''
    }
  },
  { immediate: true },
)

function fallbackDevice(type: CanvasDeviceSnapshot['type']): CanvasDeviceSnapshot {
  return {
    id: '__fallback__',
    type,
    x: 0,
    y: 0,
    label: type,
    state: {
      is_on: false,
      color: null,
      binding: { kind: 'single', signal: null },
      config: { kind: 'none' },
      data: { kind: 'none' },
    },
  }
}

function clampInt(value: string, fallback: number, min = 1, max = 1024) {
  const parsed = Number.parseInt(value, 10)
  if (Number.isNaN(parsed)) {
    return fallback
  }
  return Math.max(min, Math.min(max, parsed))
}

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function memoryWordCount(addressWidth: number) {
  return 1 << Math.min(addressWidth, CANVAS_MEMORY_MAX_ADDRESS_WIDTH)
}

function requiredMemoryAddressWidth(wordCount: number) {
  if (wordCount <= 1) {
    return 1
  }

  return Math.min(CANVAS_MEMORY_MAX_ADDRESS_WIDTH, Math.max(1, Math.ceil(Math.log2(wordCount))))
}

function memoryHexWidth(bits: number) {
  return Math.max(2, Math.ceil(bits / 4))
}

function formatMemoryAddress(index: number, addressWidth: number) {
  return index.toString(16).toUpperCase().padStart(memoryHexWidth(addressWidth), '0')
}

function formatMemoryWord(value: number, dataWidth: number) {
  return (value ?? 0).toString(16).toUpperCase().padStart(memoryHexWidth(dataWidth), '0')
}

function basenameFromPath(path: string | null | undefined) {
  if (!path) {
    return null
  }

  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}

function slotBindingValue(slotIndex: number) {
  if (!props.device || props.device.state.binding.kind !== 'slots') {
    return UNBOUND_SIGNAL
  }
  return props.device.state.binding.signals[slotIndex] ?? UNBOUND_SIGNAL
}

function singleBindingValue() {
  if (!props.device || props.device.state.binding.kind !== 'single') {
    return UNBOUND_SIGNAL
  }
  return props.device.state.binding.signal ?? UNBOUND_SIGNAL
}

function updateDevice(updater: (device: CanvasDeviceSnapshot) => CanvasDeviceSnapshot) {
  if (!props.device) {
    return
  }
  void hardwareStore.upsertCanvasDevice(updater(props.device))
}

function resizeSlotBindings(device: CanvasDeviceSnapshot, count: number) {
  const nextSignals = Array.from({ length: count }, (_, index) => {
    if (device.state.binding.kind !== 'slots') {
      return null
    }
    return device.state.binding.signals[index] ?? null
  })
  return {
    kind: 'slots' as const,
    signals: nextSignals,
  }
}

function findIndexedBus(baseName: string) {
  return indexedCompatibleBuses.value.find((bus) => bus.baseName === baseName) ?? null
}

function guessIndexedBus(
  minimumWidth: number,
  keywords: readonly string[],
  excludeBaseName?: string,
) {
  const narrowed = indexedCompatibleBuses.value.filter((bus) => {
    return bus.width >= minimumWidth && bus.baseName !== excludeBaseName
  })

  for (const keyword of keywords) {
    const match = narrowed.find((bus) => bus.baseName.toLowerCase().includes(keyword))
    if (match) {
      return match.baseName
    }
  }

  return narrowed[0]?.baseName ?? ''
}

function vgaSlotCount(mode: CanvasVgaColorMode) {
  const { redBits, greenBits, blueBits } = vgaColorModeBitCounts(mode)
  return 2 + redBits + greenBits + blueBits
}

function hd44780SlotCount(mode: CanvasHd44780BusMode) {
  return 3 + (mode === '8bit' ? 8 : 4)
}

function memorySlotCount(mode: CanvasMemoryMode, addressWidth: number, dataWidth: number) {
  if (mode === 'rom') {
    return addressWidth + dataWidth + 2
  }

  return addressWidth + dataWidth + dataWidth + 3
}

function commitName() {
  if (!props.device) return
  const nextLabel = nameInput.value.trim() || props.device.label
  if (nextLabel === props.device.label) return
  updateDevice((device) => ({ ...device, label: nextLabel }))
}

function commitColor(value: string) {
  if (!props.device) return
  const nextColor = normalizeCanvasDeviceColor(value)
  if (!nextColor) return
  colorInput.value = nextColor
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      color: nextColor,
    },
  }))
}

function commitSingleBinding(value: string) {
  if (!props.device || props.device.state.binding.kind !== 'single') return
  void hardwareStore.bindCanvasSignal(props.device.id, value === UNBOUND_SIGNAL ? null : value)
}

function commitSlotBinding(slotIndex: number, value: string) {
  if (!props.device || props.device.state.binding.kind !== 'slots') return
  void hardwareStore.bindCanvasSignalSlot(
    props.device.id,
    slotIndex,
    value === UNBOUND_SIGNAL ? null : value,
  )
}

async function applyMatrixBusBindings() {
  if (!props.device || !matrixDimensions.value) {
    return
  }

  const rowBus = findIndexedBus(matrixRowBusInput.value)
  const columnBus = findIndexedBus(matrixColumnBusInput.value)
  if (!rowBus || !columnBus) {
    return
  }

  const operations: Promise<unknown>[] = []
  for (let rowIndex = 0; rowIndex < matrixDimensions.value.rows; rowIndex += 1) {
    operations.push(
      hardwareStore.bindCanvasSignalSlot(
        props.device.id,
        rowIndex,
        rowBus.signals[rowIndex] ?? null,
      ),
    )
  }

  for (let columnIndex = 0; columnIndex < matrixDimensions.value.columns; columnIndex += 1) {
    operations.push(
      hardwareStore.bindCanvasSignalSlot(
        props.device.id,
        matrixDimensions.value.rows + columnIndex,
        columnBus.signals[columnIndex] ?? null,
      ),
    )
  }

  await Promise.all(operations)
}

async function applySegmentBusBindings() {
  if (!props.device || !segmentDisplayConfig.value) {
    return
  }

  const segmentBus = findIndexedBus(segmentBusInput.value)
  if (!segmentBus) {
    return
  }

  const operations: Promise<unknown>[] = []
  for (let segmentIndex = 0; segmentIndex < 8; segmentIndex += 1) {
    operations.push(
      hardwareStore.bindCanvasSignalSlot(
        props.device.id,
        segmentIndex,
        segmentBus.signals[segmentIndex] ?? null,
      ),
    )
  }

  if (segmentDisplayConfig.value.digits > 1) {
    const digitBus = findIndexedBus(segmentDigitBusInput.value)
    if (!digitBus) {
      return
    }

    for (let digitIndex = 0; digitIndex < segmentDisplayConfig.value.digits; digitIndex += 1) {
      operations.push(
        hardwareStore.bindCanvasSignalSlot(
          props.device.id,
          8 + digitIndex,
          digitBus.signals[digitIndex] ?? null,
        ),
      )
    }
  }

  await Promise.all(operations)
}

function commitButtonPolarity(value: string) {
  if (!props.device || props.device.state.config.kind !== 'button') return
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      config: {
        kind: 'button',
        active_low: value === 'low',
      },
    },
  }))
}

function commitSegmentConfig() {
  if (!props.device) return
  const current = getCanvasSegmentDisplayConfig(props.device)
  const digits = clampInt(numericInputs.value.segmentDigits, current?.digits ?? 1, 1, 16)
  numericInputs.value.segmentDigits = String(digits)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      binding: resizeSlotBindings(device, digits > 1 ? 8 + digits : 8),
      config: {
        kind: 'segment_display',
        digits,
        active_low:
          device.state.config.kind === 'segment_display'
            ? (device.state.config.active_low ?? false)
            : false,
      },
    },
  }))
}

function commitSegmentPolarity(value: string) {
  if (!props.device) return
  const digits = getCanvasSegmentDisplayConfig(props.device)?.digits ?? 1
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      config: {
        kind: 'segment_display',
        digits,
        active_low: value === 'low',
      },
    },
  }))
}

function commitLedMatrixConfig() {
  if (!props.device) return
  const current = getCanvasMatrixDimensions(props.device)
  const rows = clampInt(numericInputs.value.ledMatrixRows, current?.rows ?? 8, 1, 64)
  const columns = clampInt(numericInputs.value.ledMatrixColumns, current?.columns ?? 8, 1, 64)
  numericInputs.value.ledMatrixRows = String(rows)
  numericInputs.value.ledMatrixColumns = String(columns)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      binding: resizeSlotBindings(device, rows + columns),
      config: { kind: 'led_matrix', rows, columns },
    },
  }))
}

function commitDipWidth() {
  if (!props.device) return
  const current = getCanvasDipSwitchBankConfig(props.device)
  const width = clampInt(numericInputs.value.dipWidth, current?.width ?? 8, 1, 32)
  const bits = getCanvasBitsetData(props.device, width).slice(0, width)
  numericInputs.value.dipWidth = String(width)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      binding: resizeSlotBindings(device, width),
      config: { kind: 'dip_switch_bank', width },
      data: { kind: 'bitset', bits },
    },
  }))
}

function commitLedBarWidth() {
  if (!props.device) return
  const current = getCanvasLedBarConfig(props.device)
  const width = clampInt(numericInputs.value.ledBarWidth, current?.width ?? 8, 1, 32)
  numericInputs.value.ledBarWidth = String(width)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      binding: resizeSlotBindings(device, width),
      config: {
        kind: 'led_bar',
        width,
        active_low: current?.activeLow ?? false,
      },
    },
  }))
}

function commitLedBarPolarity(value: string) {
  if (!props.device) return
  const width = getCanvasLedBarConfig(props.device)?.width ?? 8
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      config: {
        kind: 'led_bar',
        width,
        active_low: value === 'low',
      },
    },
  }))
}

function commitQuadratureHasButton(value: string) {
  if (!props.device) return
  const hasButton = value === 'yes'
  const data =
    props.device.state.data.kind === 'quadrature_encoder'
      ? props.device.state.data
      : { kind: 'quadrature_encoder' as const, phase: 0, button_pressed: false }
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      binding: resizeSlotBindings(device, hasButton ? 3 : 2),
      config: {
        kind: 'quadrature_encoder',
        has_button: hasButton,
      },
      data: {
        kind: 'quadrature_encoder',
        phase: data.phase,
        button_pressed: hasButton ? data.button_pressed : false,
      },
    },
  }))
}

function commitKeypadConfig() {
  if (!props.device) return
  const current = getCanvasMatrixKeypadConfig(props.device)
  const rows = clampInt(numericInputs.value.keypadRows, current?.rows ?? 4, 1, 8)
  const columns = clampInt(numericInputs.value.keypadColumns, current?.columns ?? 4, 1, 8)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      binding: resizeSlotBindings(device, rows + columns),
      config: {
        kind: 'matrix_keypad',
        rows,
        columns,
        active_low: current?.activeLow ?? true,
      },
    },
  }))
}

function commitKeypadPolarity(value: string) {
  if (!props.device) return
  const current = getCanvasMatrixKeypadConfig(props.device)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      config: {
        kind: 'matrix_keypad',
        rows: current?.rows ?? 4,
        columns: current?.columns ?? 4,
        active_low: value === 'low',
      },
    },
  }))
}

function commitVgaResolution(value: string) {
  if (!props.device) return
  const [columnsRaw, rowsRaw] = value.split('x')
  const current = getCanvasVgaDisplayConfig(props.device)
  const columns = clampInt(columnsRaw, current?.columns ?? 320, 1, 2048)
  const rows = clampInt(rowsRaw, current?.rows ?? 240, 1, 2048)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      config: {
        kind: 'vga_display',
        columns,
        rows,
        color_mode: current?.colorMode ?? 'rgb332',
      },
    },
  }))
}

function commitVgaColorMode(value: string) {
  if (!props.device) return
  if (!['mono', 'rgb111', 'rgb332', 'rgb444', 'rgb565', 'rgb888'].includes(value)) return
  const current = getCanvasVgaDisplayConfig(props.device)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      binding: resizeSlotBindings(device, vgaSlotCount(value as CanvasVgaColorMode)),
      config: {
        kind: 'vga_display',
        columns: current?.columns ?? 320,
        rows: current?.rows ?? 240,
        color_mode: value as CanvasVgaColorMode,
      },
    },
  }))
}

function commitUartCycles() {
  if (!props.device) return
  const current = getCanvasUartTerminalConfig(props.device)
  const cyclesPerBit = clampInt(
    numericInputs.value.uartCycles,
    current?.cyclesPerBit ?? 16,
    1,
    4096,
  )
  numericInputs.value.uartCycles = String(cyclesPerBit)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      config: {
        kind: 'uart_terminal',
        cycles_per_bit: cyclesPerBit,
        mode: current?.mode ?? 'tx_rx',
      },
    },
  }))
}

function commitHd44780Size() {
  if (!props.device) return
  const current = getCanvasHd44780LcdConfig(props.device)
  const columns = clampInt(numericInputs.value.lcdColumns, current?.columns ?? 16, 8, 40)
  const rows = clampInt(numericInputs.value.lcdRows, current?.rows ?? 2, 1, 4)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      config: {
        kind: 'hd44780_lcd',
        columns,
        rows,
        bus_mode: current?.busMode ?? '4bit',
      },
    },
  }))
}

function commitHd44780BusMode(value: string) {
  if (!props.device) return
  if (value !== '4bit' && value !== '8bit') return
  const current = getCanvasHd44780LcdConfig(props.device)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      binding: resizeSlotBindings(device, hd44780SlotCount(value as CanvasHd44780BusMode)),
      config: {
        kind: 'hd44780_lcd',
        columns: current?.columns ?? 16,
        rows: current?.rows ?? 2,
        bus_mode: value as CanvasHd44780BusMode,
      },
    },
  }))
}

function commitMemoryGeometry() {
  if (!props.device) return
  const current = getCanvasMemoryConfig(props.device)
  const currentData = getCanvasMemoryData(props.device)
  const addressWidth = clampInt(
    numericInputs.value.memoryAddressWidth,
    current?.addressWidth ?? 8,
    1,
    CANVAS_MEMORY_MAX_ADDRESS_WIDTH,
  )
  const dataWidth = clampInt(numericInputs.value.memoryDataWidth, current?.dataWidth ?? 8, 1, 16)
  const wordCount = memoryWordCount(addressWidth)
  const previousWords = getCanvasMemoryWordsData(props.device, wordCount)
  const words = Array.from({ length: wordCount }, (_, index) => previousWords[index] ?? 0)
  const previewOffset = clampInt(
    numericInputs.value.memoryPreviewOffset,
    currentData.previewOffset,
    0,
    Math.max(0, wordCount - 1),
  )
  numericInputs.value.memoryPreviewOffset = String(previewOffset)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      binding: resizeSlotBindings(
        device,
        memorySlotCount(current?.mode ?? 'ram', addressWidth, dataWidth),
      ),
      config: {
        kind: 'memory',
        mode: current?.mode ?? 'ram',
        address_width: addressWidth,
        data_width: dataWidth,
      },
      data: {
        kind: 'memory',
        words,
        source_path: currentData.sourcePath,
        preview_offset: previewOffset,
      },
    },
  }))
}

function commitMemoryMode(value: string) {
  if (!props.device) return
  if (value !== 'rom' && value !== 'ram') return
  const current = getCanvasMemoryConfig(props.device)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      binding: resizeSlotBindings(
        device,
        memorySlotCount(
          value as CanvasMemoryMode,
          current?.addressWidth ?? 8,
          current?.dataWidth ?? 8,
        ),
      ),
      config: {
        kind: 'memory',
        mode: value as CanvasMemoryMode,
        address_width: current?.addressWidth ?? 8,
        data_width: current?.dataWidth ?? 8,
      },
    },
  }))
}

function commitMemoryPreviewOffset() {
  if (!props.device || props.device.type !== 'memory') return
  const config = getCanvasMemoryConfig(props.device)
  const data = getCanvasMemoryData(props.device)
  const wordCount = memoryWordCount(config?.addressWidth ?? 8)
  const previewOffset = clampInt(
    numericInputs.value.memoryPreviewOffset,
    data.previewOffset,
    0,
    Math.max(0, wordCount - 1),
  )
  numericInputs.value.memoryPreviewOffset = String(previewOffset)
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      data: {
        kind: 'memory',
        words: data.words,
        source_path: data.sourcePath,
        preview_offset: previewOffset,
      },
    },
  }))
}

function commitMemoryPreviewWord(index: number, value: string) {
  if (!props.device || props.device.type !== 'memory') return
  const config = getCanvasMemoryConfig(props.device)
  const data = getCanvasMemoryData(props.device)
  const parsed = Number.parseInt(value, 16)
  if (Number.isNaN(parsed)) {
    return
  }
  const dataWidth = config?.dataWidth ?? 8
  const dataMask = dataWidth >= 16 ? 0xffff : (1 << dataWidth) - 1
  const words = [...data.words]
  if (index < 0 || index >= words.length) {
    return
  }
  words[index] = parsed & dataMask
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      data: {
        kind: 'memory',
        words,
        source_path: data.sourcePath,
        preview_offset: data.previewOffset,
      },
    },
  }))
}

async function loadMemoryImage() {
  if (!props.device || props.device.type !== 'memory') return

  const current = getCanvasMemoryConfig(props.device) ?? {
    mode: 'ram' as CanvasMemoryMode,
    addressWidth: 8,
    dataWidth: 8,
  }

  try {
    const selected = await openDialog({
      multiple: false,
      filters: [
        {
          name: 'Memory Image',
          extensions: ['hex', 'mem', 'mif', 'coe', 'txt', 'bin', 'rom', 'ram'],
        },
      ],
    })

    if (typeof selected !== 'string') {
      return
    }

    const parsed = await loadHardwareMemoryImage(selected, current.dataWidth)
    const requiredWidth = requiredMemoryAddressWidth(parsed.words.length)
    const nextAddressWidth = Math.max(current.addressWidth, requiredWidth)
    const wordCount = memoryWordCount(nextAddressWidth)
    const words = Array.from({ length: wordCount }, (_, index) => parsed.words[index] ?? 0)

    numericInputs.value.memoryAddressWidth = String(nextAddressWidth)
    numericInputs.value.memoryPreviewOffset = '0'

    updateDevice((device) => ({
      ...device,
      state: {
        ...device.state,
        binding: resizeSlotBindings(
          device,
          memorySlotCount(current.mode, nextAddressWidth, current.dataWidth),
        ),
        config: {
          kind: 'memory',
          mode: current.mode,
          address_width: nextAddressWidth,
          data_width: current.dataWidth,
        },
        data: {
          kind: 'memory',
          words,
          source_path: parsed.source_path,
          preview_offset: 0,
        },
      },
    }))
  } catch (err) {
    window.alert(`Failed to load memory image: ${getErrorMessage(err)}`)
  }
}

function clearMemoryData() {
  if (!props.device || props.device.type !== 'memory') return
  const config = getCanvasMemoryConfig(props.device)
  const wordCount = memoryWordCount(config?.addressWidth ?? 8)
  numericInputs.value.memoryPreviewOffset = '0'
  updateDevice((device) => ({
    ...device,
    state: {
      ...device.state,
      data: {
        kind: 'memory',
        words: Array.from({ length: wordCount }, () => 0),
        source_path: null,
        preview_offset: 0,
      },
    },
  }))
}

async function removeDevice() {
  if (!props.device) return
  if (
    settingsStore.state.confirmDelete &&
    !(await confirmAction(t('deleteDeviceConfirm', { name: props.device.label }), {
      title: t('deleteDeviceTitle'),
    }))
  ) {
    return
  }

  void hardwareStore.removeCanvasDevice(props.device.id)
  emit('close')
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-card/85">
    <ScrollArea class="h-full">
      <div v-if="device" class="flex min-h-full flex-col p-5">
        <div class="flex items-start gap-3">
          <div class="grid h-11 w-11 place-items-center rounded-2xl border border-border bg-muted">
            <Link2 class="h-5 w-5 text-muted-foreground" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-lg font-semibold">{{ device.label }}</p>
            <p class="text-xs uppercase tracking-[0.28em] text-muted-foreground">
              {{ device.type }}
            </p>
          </div>
          <Button variant="ghost" size="icon" class="h-8 w-8" @click="$emit('close')">
            <X class="h-4 w-4" />
          </Button>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <Badge variant="secondary">{{ capabilityLabel }}</Badge>
          <Badge variant="outline">{{ liveLevel ? t('high') : t('low') }}</Badge>
          <Badge variant="outline">{{ bindingSlots.length }} pins</Badge>
        </div>

        <Separator class="my-5" />

        <section class="space-y-3">
          <p class="text-sm font-medium">{{ t('name') }}</p>
          <Input v-model="nameInput" @blur="commitName" @keydown.enter.prevent="commitName" />
        </section>

        <Separator class="my-5" />

        <section
          v-if="device.type === 'led' || device.type === 'led_bar' || device.type === 'led_matrix'"
          class="space-y-3"
        >
          <p class="text-sm font-medium">{{ t('color') }}</p>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="(color, key) in CANVAS_DEVICE_PRESET_COLORS"
              :key="key"
              type="button"
              class="flex items-center gap-2 rounded-md border px-2 py-2 text-xs"
              :class="
                normalizeCanvasDeviceColor(colorInput) === color
                  ? 'border-primary bg-primary/5'
                  : 'border-border bg-background'
              "
              @click="commitColor(color)"
            >
              <span
                class="h-4 w-4 rounded-full border border-black/10"
                :style="{ backgroundColor: color }"
              />
              <span>{{ key }}</span>
            </button>
          </div>
        </section>

        <Separator
          v-if="device.type === 'led' || device.type === 'led_bar' || device.type === 'led_matrix'"
          class="my-5"
        />

        <section v-if="device.state.binding.kind === 'single'" class="space-y-3">
          <p class="text-sm font-medium">Signal</p>
          <Select
            :model-value="singleBindingValue()"
            @update:model-value="(value) => commitSingleBinding(String(value))"
          >
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem :value="UNBOUND_SIGNAL">Unbound</SelectItem>
              <SelectItem
                v-for="signal in compatibleSignals"
                :key="signal.name"
                :value="signal.name"
              >
                {{ signal.name }}
              </SelectItem>
            </SelectContent>
          </Select>
        </section>

        <section v-else class="space-y-3">
          <div
            v-if="device.type === 'led_matrix'"
            class="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3"
          >
            <div>
              <p class="text-sm font-medium">{{ t('quickBind') }}</p>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                {{ t('quickBindDescription') }}
              </p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5">
                <p class="text-xs font-medium text-muted-foreground">{{ t('rowBus') }}</p>
                <Select
                  :model-value="matrixRowBusInput"
                  @update:model-value="(value) => (matrixRowBusInput = String(value))"
                >
                  <SelectTrigger class="w-full"
                    ><SelectValue :placeholder="t('chooseBus')"
                  /></SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="bus in matrixRowBusOptions"
                      :key="`matrix-row-${bus.baseName}`"
                      :value="bus.baseName"
                    >
                      <span class="font-mono text-xs">{{ bus.label }}</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div class="space-y-1.5">
                <p class="text-xs font-medium text-muted-foreground">{{ t('columnBus') }}</p>
                <Select
                  :model-value="matrixColumnBusInput"
                  @update:model-value="(value) => (matrixColumnBusInput = String(value))"
                >
                  <SelectTrigger class="w-full"
                    ><SelectValue :placeholder="t('chooseBus')"
                  /></SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="bus in matrixColumnBusOptions"
                      :key="`matrix-column-${bus.baseName}`"
                      :value="bus.baseName"
                    >
                      <span class="font-mono text-xs">{{ bus.label }}</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              variant="outline"
              class="w-full"
              :disabled="!matrixRowBusInput || !matrixColumnBusInput"
              @click="applyMatrixBusBindings"
            >
              {{ t('applyBusBindings') }}
            </Button>
            <p
              v-if="matrixRowBusOptions.length === 0 || matrixColumnBusOptions.length === 0"
              class="text-xs leading-5 text-muted-foreground"
            >
              {{ t('noMatchingBuses') }}
            </p>
          </div>

          <div
            v-if="device.type === 'segment_display'"
            class="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3"
          >
            <div>
              <p class="text-sm font-medium">{{ t('quickBind') }}</p>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                {{ t('quickBindDescription') }}
              </p>
            </div>
            <div class="space-y-3">
              <div class="space-y-1.5">
                <p class="text-xs font-medium text-muted-foreground">{{ t('segmentBus') }}</p>
                <Select
                  :model-value="segmentBusInput"
                  @update:model-value="(value) => (segmentBusInput = String(value))"
                >
                  <SelectTrigger class="w-full"
                    ><SelectValue :placeholder="t('chooseBus')"
                  /></SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="bus in segmentBusOptions"
                      :key="`segment-${bus.baseName}`"
                      :value="bus.baseName"
                    >
                      <span class="font-mono text-xs">{{ bus.label }}</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div v-if="(segmentDisplayConfig?.digits ?? 1) > 1" class="space-y-1.5">
                <p class="text-xs font-medium text-muted-foreground">{{ t('digitSelectBus') }}</p>
                <Select
                  :model-value="segmentDigitBusInput"
                  @update:model-value="(value) => (segmentDigitBusInput = String(value))"
                >
                  <SelectTrigger class="w-full"
                    ><SelectValue :placeholder="t('chooseBus')"
                  /></SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="bus in segmentDigitBusOptions"
                      :key="`digit-${bus.baseName}`"
                      :value="bus.baseName"
                    >
                      <span class="font-mono text-xs">{{ bus.label }}</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button
              variant="outline"
              class="w-full"
              :disabled="
                !segmentBusInput ||
                ((segmentDisplayConfig?.digits ?? 1) > 1 && !segmentDigitBusInput)
              "
              @click="applySegmentBusBindings"
            >
              {{ t('applyBusBindings') }}
            </Button>
            <p
              v-if="
                segmentBusOptions.length === 0 ||
                ((segmentDisplayConfig?.digits ?? 1) > 1 && segmentDigitBusOptions.length === 0)
              "
              class="text-xs leading-5 text-muted-foreground"
            >
              {{ t('noMatchingBuses') }}
            </p>
          </div>

          <p class="text-sm font-medium">Pins</p>
          <div class="grid gap-3">
            <div v-for="(slot, index) in bindingSlots" :key="slot.key" class="grid gap-1.5">
              <p class="text-xs font-medium text-muted-foreground">{{ slot.label }}</p>
              <Select
                :model-value="slotBindingValue(index)"
                @update:model-value="(value) => commitSlotBinding(index, String(value))"
              >
                <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem :value="UNBOUND_SIGNAL">Unbound</SelectItem>
                  <SelectItem
                    v-for="signal in compatibleSignals"
                    :key="signal.name"
                    :value="signal.name"
                  >
                    {{ signal.name }}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <Separator class="my-5" />

        <section v-if="device.type === 'button'" class="space-y-3">
          <p class="text-sm font-medium">Active level</p>
          <Select
            :model-value="(getCanvasButtonConfig(device)?.activeLow ?? false) ? 'low' : 'high'"
            @update:model-value="(value) => commitButtonPolarity(String(value))"
          >
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="high">Active high</SelectItem>
              <SelectItem value="low">Active low</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <section v-if="device.type === 'segment_display'" class="space-y-3">
          <p class="text-sm font-medium">Segment display</p>
          <Input
            v-model="numericInputs.segmentDigits"
            type="number"
            min="1"
            max="16"
            @blur="commitSegmentConfig"
            @keydown.enter.prevent="commitSegmentConfig"
          />
          <Select
            :model-value="
              (getCanvasSegmentDisplayConfig(device)?.activeLow ?? false) ? 'low' : 'high'
            "
            @update:model-value="(value) => commitSegmentPolarity(String(value))"
          >
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="high">Active high</SelectItem>
              <SelectItem value="low">Active low</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <section v-if="device.type === 'led_matrix'" class="space-y-3">
          <p class="text-sm font-medium">LED matrix</p>
          <div class="grid grid-cols-2 gap-3">
            <Input
              v-model="numericInputs.ledMatrixRows"
              type="number"
              min="1"
              max="64"
              @blur="commitLedMatrixConfig"
              @keydown.enter.prevent="commitLedMatrixConfig"
            />
            <Input
              v-model="numericInputs.ledMatrixColumns"
              type="number"
              min="1"
              max="64"
              @blur="commitLedMatrixConfig"
              @keydown.enter.prevent="commitLedMatrixConfig"
            />
          </div>
        </section>

        <section v-if="device.type === 'dip_switch_bank'" class="space-y-3">
          <p class="text-sm font-medium">DIP switch bank</p>
          <Input
            v-model="numericInputs.dipWidth"
            type="number"
            min="1"
            max="32"
            @blur="commitDipWidth"
            @keydown.enter.prevent="commitDipWidth"
          />
          <p class="text-xs text-muted-foreground">
            Current bits:
            {{
              getCanvasBitsetData(device, getCanvasDipSwitchBankConfig(device)?.width ?? 8)
                .map((bit) => (bit ? 1 : 0))
                .join('')
            }}
          </p>
        </section>

        <section v-if="device.type === 'led_bar'" class="space-y-3">
          <p class="text-sm font-medium">LED bar</p>
          <Input
            v-model="numericInputs.ledBarWidth"
            type="number"
            min="1"
            max="32"
            @blur="commitLedBarWidth"
            @keydown.enter.prevent="commitLedBarWidth"
          />
          <Select
            :model-value="(getCanvasLedBarConfig(device)?.activeLow ?? false) ? 'low' : 'high'"
            @update:model-value="(value) => commitLedBarPolarity(String(value))"
          >
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="high">Active high</SelectItem>
              <SelectItem value="low">Active low</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <section v-if="device.type === 'quadrature_encoder'" class="space-y-3">
          <p class="text-sm font-medium">Quadrature encoder</p>
          <Select
            :model-value="
              (getCanvasQuadratureEncoderConfig(device)?.hasButton ?? true) ? 'yes' : 'no'
            "
            @update:model-value="(value) => commitQuadratureHasButton(String(value))"
          >
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="yes">With push button</SelectItem>
              <SelectItem value="no">A/B only</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <section v-if="device.type === 'matrix_keypad'" class="space-y-3">
          <p class="text-sm font-medium">Matrix keypad</p>
          <div class="grid grid-cols-2 gap-3">
            <Input
              v-model="numericInputs.keypadRows"
              type="number"
              min="1"
              max="8"
              @blur="commitKeypadConfig"
              @keydown.enter.prevent="commitKeypadConfig"
            />
            <Input
              v-model="numericInputs.keypadColumns"
              type="number"
              min="1"
              max="8"
              @blur="commitKeypadConfig"
              @keydown.enter.prevent="commitKeypadConfig"
            />
          </div>
          <Select
            :model-value="(getCanvasMatrixKeypadConfig(device)?.activeLow ?? true) ? 'low' : 'high'"
            @update:model-value="(value) => commitKeypadPolarity(String(value))"
          >
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="low">Active low scan</SelectItem>
              <SelectItem value="high">Active high scan</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <section v-if="device.type === 'vga_display'" class="space-y-3">
          <p class="text-sm font-medium">VGA display</p>
          <Select
            :model-value="`${getCanvasVgaDisplayConfig(device)?.columns ?? 320}x${getCanvasVgaDisplayConfig(device)?.rows ?? 240}`"
            @update:model-value="(value) => commitVgaResolution(String(value))"
          >
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem
                v-for="preset in VGA_DISPLAY_RESOLUTION_PRESETS"
                :key="preset.key"
                :value="`${preset.columns}x${preset.rows}`"
              >
                {{ preset.columns }} × {{ preset.rows }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select
            :model-value="getCanvasVgaDisplayConfig(device)?.colorMode ?? 'rgb332'"
            @update:model-value="(value) => commitVgaColorMode(String(value))"
          >
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="mono">Mono</SelectItem>
              <SelectItem value="rgb111">RGB111</SelectItem>
              <SelectItem value="rgb332">RGB332</SelectItem>
              <SelectItem value="rgb444">RGB444</SelectItem>
              <SelectItem value="rgb565">RGB565</SelectItem>
              <SelectItem value="rgb888">RGB888</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <section v-if="device.type === 'uart_terminal'" class="space-y-3">
          <p class="text-sm font-medium">UART terminal</p>
          <Input
            v-model="numericInputs.uartCycles"
            type="number"
            min="1"
            max="4096"
            @blur="commitUartCycles"
            @keydown.enter.prevent="commitUartCycles"
          />
        </section>

        <section v-if="device.type === 'hd44780_lcd'" class="space-y-3">
          <p class="text-sm font-medium">HD44780 LCD</p>
          <div class="grid grid-cols-2 gap-3">
            <Input
              v-model="numericInputs.lcdColumns"
              type="number"
              min="8"
              max="40"
              @blur="commitHd44780Size"
              @keydown.enter.prevent="commitHd44780Size"
            />
            <Input
              v-model="numericInputs.lcdRows"
              type="number"
              min="1"
              max="4"
              @blur="commitHd44780Size"
              @keydown.enter.prevent="commitHd44780Size"
            />
          </div>
          <Select
            :model-value="getCanvasHd44780LcdConfig(device)?.busMode ?? '4bit'"
            @update:model-value="(value) => commitHd44780BusMode(String(value))"
          >
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="4bit">4-bit bus</SelectItem>
              <SelectItem value="8bit">8-bit bus</SelectItem>
            </SelectContent>
          </Select>
        </section>

        <section v-if="device.type === 'memory'" class="space-y-3">
          <p class="text-sm font-medium">ROM / RAM</p>
          <Select
            :model-value="getCanvasMemoryConfig(device)?.mode ?? 'ram'"
            @update:model-value="(value) => commitMemoryMode(String(value))"
          >
            <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="rom">ROM</SelectItem>
              <SelectItem value="ram">RAM</SelectItem>
            </SelectContent>
          </Select>
          <div class="grid grid-cols-2 gap-3">
            <Input
              v-model="numericInputs.memoryAddressWidth"
              type="number"
              min="1"
              :max="CANVAS_MEMORY_MAX_ADDRESS_WIDTH"
              @blur="commitMemoryGeometry"
              @keydown.enter.prevent="commitMemoryGeometry"
            />
            <Input
              v-model="numericInputs.memoryDataWidth"
              type="number"
              min="1"
              max="16"
              @blur="commitMemoryGeometry"
              @keydown.enter.prevent="commitMemoryGeometry"
            />
          </div>
          <div class="flex gap-2">
            <Button variant="outline" class="flex-1" @click="loadMemoryImage">Load file</Button>
            <Button variant="outline" class="flex-1" @click="clearMemoryData">Clear data</Button>
          </div>
          <div
            class="rounded-md border border-border/70 bg-background/70 px-3 py-2 text-xs text-muted-foreground"
          >
            <div class="font-medium text-foreground">{{ t('memoryImageFormatsTitle') }}</div>
            <div class="mt-1">{{ t('memoryImageFormatsVivado') }}</div>
            <div>{{ t('memoryImageFormatsQuartus') }}</div>
            <div>{{ t('memoryImageFormatsBinary') }}</div>
            <div>{{ t('memoryImageFormatsPlainText') }}</div>
          </div>
          <div
            class="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          >
            <div>{{ getCanvasMemoryWordsData(device).length }} words allocated</div>
            <div class="truncate">
              Source:
              <span class="text-foreground">{{
                memorySourceLabel ?? 'inline / zero-initialized'
              }}</span>
            </div>
          </div>
          <div class="space-y-2 rounded-md border border-border/70 bg-background/70 p-3">
            <div class="flex items-center justify-between gap-3">
              <p class="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Preview window
              </p>
              <Input
                v-model="numericInputs.memoryPreviewOffset"
                type="number"
                min="0"
                class="h-8 w-28 font-mono"
                @blur="commitMemoryPreviewOffset"
                @keydown.enter.prevent="commitMemoryPreviewOffset"
              />
            </div>
            <div class="grid max-h-72 gap-2 overflow-auto">
              <label
                v-for="row in memoryPreviewRows"
                :key="row.index"
                class="flex items-center gap-3 rounded border border-border/70 bg-muted/20 px-3 py-2"
              >
                <span class="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                  {{
                    formatMemoryAddress(row.index, getCanvasMemoryConfig(device)?.addressWidth ?? 8)
                  }}
                </span>
                <Input
                  class="h-8 min-w-0 flex-1 font-mono"
                  :value="
                    formatMemoryWord(row.value, getCanvasMemoryConfig(device)?.dataWidth ?? 8)
                  "
                  @change="
                    commitMemoryPreviewWord(row.index, ($event.target as HTMLInputElement).value)
                  "
                />
              </label>
            </div>
          </div>
        </section>

        <Separator class="my-5" />

        <div class="flex gap-2">
          <Button
            variant="outline"
            class="flex-1"
            @click="
              device.state.binding.kind === 'single'
                ? commitSingleBinding(UNBOUND_SIGNAL)
                : bindingSlots.forEach((_, index) => commitSlotBinding(index, UNBOUND_SIGNAL))
            "
          >
            <Unplug class="mr-2 h-4 w-4" />
            {{ t('clearBindings') }}
          </Button>
          <Button variant="destructive" class="flex-1" @click="removeDevice">
            <Trash2 class="mr-2 h-4 w-4" />
            {{ t('delete') }}
          </Button>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
