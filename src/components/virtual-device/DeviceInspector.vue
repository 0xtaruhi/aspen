<script setup lang="ts">
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import type { SignalCatalogEntry } from '@/stores/signal-catalog'

import { computed, ref, watch } from 'vue'
import { CheckCircle2, Link2, Trash2, Unplug, X } from 'lucide-vue-next'

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
  CANVAS_DEVICE_PRESET_COLORS,
  type CanvasDeviceColorOption,
  getCanvasButtonConfig,
  deviceDrivesSignal,
  deviceReceivesSignal,
  getCanvasDeviceBoundSignal,
  getCanvasDeviceBoundSignalCount,
  getCanvasDeviceBoundSignals,
  getCanvasDeviceBindingSlots,
  getCanvasMatrixDimensions,
  getCanvasSegmentDisplayConfig,
  normalizeCanvasDeviceColor,
  resolveCanvasDeviceColor,
  isCanvasMatrixDevice,
  isCanvasSegmentDisplayDevice,
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
const MATRIX_DIMENSION_MIN = 1
const MATRIX_DIMENSION_MAX = 32
const SEGMENT_DIGITS_MIN = 1
const SEGMENT_DIGITS_MAX = 16
const ACTIVE_HIGH = 'high'
const ACTIVE_LOW = 'low'
const DEVICE_COLOR_OPTIONS: CanvasDeviceColorOption[] = [
  'red',
  'green',
  'blue',
  'yellow',
  'orange',
  'white',
]

const matrixRowsInput = ref('')
const matrixColumnsInput = ref('')
const segmentDigitsInput = ref('')
const buttonPolarityInput = ref(ACTIVE_HIGH)
const segmentPolarityInput = ref(ACTIVE_HIGH)
const deviceColorInput = ref(CANVAS_DEVICE_PRESET_COLORS.red)
const deviceNameInput = ref('')
const matrixRowBusInput = ref('')
const matrixColumnBusInput = ref('')
const segmentBusInput = ref('')
const segmentDigitBusInput = ref('')
const { t } = useI18n()

const capabilityLabel = computed(() => {
  if (!props.device) {
    return ''
  }

  const drives = deviceDrivesSignal(props.device.type)
  const receives = deviceReceivesSignal(props.device.type)

  if (drives && !receives) {
    return t('drivesFpgaInput')
  }

  if (receives && !drives) {
    return t('observesFpgaOutput')
  }

  return t('bidirectionalDevice')
})

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

const bindingValue = computed(() => {
  if (!props.device) {
    return UNBOUND_SIGNAL
  }

  return getCanvasDeviceBoundSignal(props.device) ?? UNBOUND_SIGNAL
})

const bindingSlots = computed(() => {
  if (!props.device) {
    return []
  }

  return getCanvasDeviceBindingSlots(props.device)
})

const hasSlotBindings = computed(() => bindingSlots.value.length > 0)

const matrixDimensions = computed(() => {
  if (!props.device) {
    return null
  }

  return getCanvasMatrixDimensions(props.device)
})

const isMatrixDevice = computed(() => {
  return props.device ? isCanvasMatrixDevice(props.device.type) : false
})

const segmentDisplayConfig = computed(() => {
  if (!props.device) {
    return null
  }

  return getCanvasSegmentDisplayConfig(props.device)
})

const buttonConfig = computed(() => {
  if (!props.device) {
    return null
  }

  return getCanvasButtonConfig(props.device)
})

const isButtonDevice = computed(() => props.device?.type === 'button')
const supportsDeviceColor = computed(() => {
  const type = props.device?.type
  return type === 'led' || type === 'led_matrix'
})

const isSegmentDisplayDevice = computed(() => {
  return props.device ? isCanvasSegmentDisplayDevice(props.device.type) : false
})

const boundSignalCount = computed(() => {
  if (!props.device) {
    return 0
  }

  return getCanvasDeviceBoundSignalCount(props.device)
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

const streamRunning = computed(() => hardwareStore.dataStreamStatus.value.running)

const liveLevel = computed(() => {
  if (!streamRunning.value) {
    return false
  }

  const deviceId = props.device?.id
  if (deviceId) {
    const deviceTelemetry = hardwareStore.deviceTelemetry.value[deviceId]
    if (deviceTelemetry) {
      return deviceTelemetry.latest
    }
  }

  const signal = props.device ? getCanvasDeviceBoundSignal(props.device) : null
  if (!signal) {
    return props.device?.state.is_on ?? false
  }
  const telemetry = hardwareStore.signalTelemetry.value[signal]
  if (telemetry && deviceReceivesSignal(props.device?.type ?? 'led')) {
    return telemetry.latest
  }

  return props.device?.state.is_on ?? false
})

const stateLabel = computed(() => {
  if (!props.device) {
    return t('idle')
  }

  return liveLevel.value ? t('high') : t('low')
})

watch(
  () => {
    const device = props.device
    if (!device) {
      return null
    }

    return {
      id: device.id,
      label: device.label,
    }
  },
  (nextDeviceState) => {
    deviceNameInput.value = nextDeviceState?.label ?? ''
  },
  { immediate: true },
)

watch(
  () => {
    const device = props.device
    if (!device) {
      return null
    }

    return {
      id: device.id,
      type: device.type,
      rows: matrixDimensions.value?.rows ?? null,
      columns: matrixDimensions.value?.columns ?? null,
      digits: segmentDisplayConfig.value?.digits ?? null,
      indexedBuses: indexedCompatibleBuses.value
        .map((bus) => `${bus.baseName}:${bus.width}`)
        .join('|'),
    }
  },
  () => {
    if (isMatrixDevice.value && matrixDimensions.value) {
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

    if (isSegmentDisplayDevice.value && segmentDisplayConfig.value) {
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

watch(
  () => {
    const device = props.device
    if (!device) {
      return null
    }

    return {
      id: device.id,
      color: resolveCanvasDeviceColor(device),
    }
  },
  (nextColorState) => {
    deviceColorInput.value = nextColorState?.color ?? CANVAS_DEVICE_PRESET_COLORS.red
  },
  { immediate: true },
)

watch(
  () => {
    const device = props.device
    if (!device) {
      return null
    }

    const dimensions = getCanvasMatrixDimensions(device)
    return {
      id: device.id,
      rows: dimensions?.rows ?? null,
      columns: dimensions?.columns ?? null,
    }
  },
  (nextMatrixState) => {
    matrixRowsInput.value = nextMatrixState?.rows ? String(nextMatrixState.rows) : ''
    matrixColumnsInput.value = nextMatrixState?.columns ? String(nextMatrixState.columns) : ''
  },
  { immediate: true },
)

watch(
  () => {
    const device = props.device
    if (!device) {
      return null
    }

    const config = getCanvasSegmentDisplayConfig(device)
    return {
      id: device.id,
      digits: config?.digits ?? null,
      activeLow: config?.activeLow ?? false,
    }
  },
  (nextSegmentState) => {
    segmentDigitsInput.value = nextSegmentState?.digits ? String(nextSegmentState.digits) : ''
    segmentPolarityInput.value = nextSegmentState?.activeLow ? ACTIVE_LOW : ACTIVE_HIGH
  },
  { immediate: true },
)

watch(
  () => {
    const device = props.device
    if (!device) {
      return null
    }

    const config = getCanvasButtonConfig(device)
    return {
      id: device.id,
      activeLow: config?.activeLow ?? false,
    }
  },
  (nextButtonState) => {
    buttonPolarityInput.value = nextButtonState?.activeLow ? ACTIVE_LOW : ACTIVE_HIGH
  },
  { immediate: true },
)

function handleBindingUpdate(value: unknown) {
  if (!props.device || typeof value !== 'string') {
    return
  }

  void hardwareStore.bindCanvasSignal(props.device.id, value === UNBOUND_SIGNAL ? null : value)
}

function slotBindingValue(slotIndex: number) {
  return props.device
    ? (getCanvasDeviceBoundSignals(props.device)[slotIndex] ?? UNBOUND_SIGNAL)
    : UNBOUND_SIGNAL
}

function handleSlotBindingUpdate(slotIndex: number, value: unknown) {
  if (!props.device || typeof value !== 'string') {
    return
  }

  void hardwareStore.bindCanvasSignalSlot(
    props.device.id,
    slotIndex,
    value === UNBOUND_SIGNAL ? null : value,
  )
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

function clearBinding() {
  if (!props.device) {
    return
  }

  if (hasSlotBindings.value) {
    void Promise.all(
      bindingSlots.value.map((_, slotIndex) => {
        return hardwareStore.bindCanvasSignalSlot(props.device!.id, slotIndex, null)
      }),
    )
    return
  }

  void hardwareStore.bindCanvasSignal(props.device.id, null)
}

function formatSignalDirection(direction: SignalCatalogEntry['direction']) {
  switch (direction) {
    case 'input':
      return t('inputDirection')
    case 'output':
      return t('outputDirection')
    case 'inout':
      return t('inoutDirection')
    default:
      return direction
  }
}

function normalizeMatrixDimensionInput(rawValue: string, fallback: number) {
  const parsed = Number.parseInt(rawValue, 10)
  if (Number.isNaN(parsed)) {
    return fallback
  }

  return Math.min(MATRIX_DIMENSION_MAX, Math.max(MATRIX_DIMENSION_MIN, parsed))
}

function normalizeSegmentDigitInput(rawValue: string, fallback: number) {
  const parsed = Number.parseInt(rawValue, 10)
  if (Number.isNaN(parsed)) {
    return fallback
  }

  return Math.min(SEGMENT_DIGITS_MAX, Math.max(SEGMENT_DIGITS_MIN, parsed))
}

async function commitDeviceName() {
  if (!props.device) {
    return
  }

  const nextLabel = deviceNameInput.value.trim()
  const resolvedLabel = nextLabel.length > 0 ? nextLabel : props.device.label
  deviceNameInput.value = resolvedLabel

  if (resolvedLabel === props.device.label) {
    return
  }

  await hardwareStore.upsertCanvasDevice({
    ...props.device,
    label: resolvedLabel,
  })
}

async function commitMatrixDimensions() {
  if (!props.device || !matrixDimensions.value) {
    return
  }

  const nextRows = normalizeMatrixDimensionInput(matrixRowsInput.value, matrixDimensions.value.rows)
  const nextColumns = normalizeMatrixDimensionInput(
    matrixColumnsInput.value,
    matrixDimensions.value.columns,
  )

  matrixRowsInput.value = String(nextRows)
  matrixColumnsInput.value = String(nextColumns)

  if (
    nextRows === matrixDimensions.value.rows &&
    nextColumns === matrixDimensions.value.columns &&
    props.device.type === 'led_matrix'
  ) {
    return
  }

  const nextBoundSignals = Array.from({ length: nextRows + nextColumns }, (_, index) => {
    return getCanvasDeviceBoundSignals(props.device!)[index] ?? null
  })

  await hardwareStore.upsertCanvasDevice({
    ...props.device,
    type: 'led_matrix',
    state: {
      ...props.device.state,
      binding: {
        kind: 'slots',
        signals: nextBoundSignals,
      },
      config: {
        kind: 'led_matrix',
        rows: nextRows,
        columns: nextColumns,
      },
    },
  })
}

async function commitSegmentDigits() {
  if (!props.device || !segmentDisplayConfig.value) {
    return
  }

  const nextDigits = normalizeSegmentDigitInput(
    segmentDigitsInput.value,
    segmentDisplayConfig.value.digits,
  )
  segmentDigitsInput.value = String(nextDigits)

  if (nextDigits === segmentDisplayConfig.value.digits && props.device.type === 'segment_display') {
    return
  }

  const nextSlotCount = nextDigits > 1 ? 8 + nextDigits : 8
  const nextBoundSignals = Array.from({ length: nextSlotCount }, (_, index) => {
    return getCanvasDeviceBoundSignals(props.device!)[index] ?? null
  })

  await hardwareStore.upsertCanvasDevice({
    ...props.device,
    type: 'segment_display',
    state: {
      ...props.device.state,
      binding: {
        kind: 'slots',
        signals: nextBoundSignals,
      },
      config: {
        kind: 'segment_display',
        digits: nextDigits,
        active_low: segmentDisplayConfig.value.activeLow,
      },
    },
  })
}

async function commitButtonPolarity(value: unknown) {
  if (!props.device || props.device.type !== 'button' || typeof value !== 'string') {
    return
  }

  const activeLow = value === ACTIVE_LOW
  buttonPolarityInput.value = activeLow ? ACTIVE_LOW : ACTIVE_HIGH
  const currentConfig = getCanvasButtonConfig(props.device)
  if (currentConfig?.activeLow === activeLow) {
    return
  }

  await hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      config: {
        kind: 'button',
        active_low: activeLow,
      },
    },
  })
}

async function commitSegmentPolarity(value: unknown) {
  if (!props.device || !segmentDisplayConfig.value || typeof value !== 'string') {
    return
  }

  const activeLow = value === ACTIVE_LOW
  segmentPolarityInput.value = activeLow ? ACTIVE_LOW : ACTIVE_HIGH
  if (segmentDisplayConfig.value.activeLow === activeLow) {
    return
  }

  await hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      config: {
        kind: 'segment_display',
        digits: segmentDisplayConfig.value.digits,
        active_low: activeLow,
      },
    },
  })
}

async function commitDeviceColor(value: string) {
  if (!props.device) {
    return
  }

  const nextColor = normalizeCanvasDeviceColor(value) ?? CANVAS_DEVICE_PRESET_COLORS.red
  deviceColorInput.value = nextColor

  if (
    resolveCanvasDeviceColor(props.device) === nextColor &&
    props.device.state.color === nextColor
  ) {
    return
  }

  await hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      color: nextColor,
    },
  })
}

function applyPresetDeviceColor(color: CanvasDeviceColorOption) {
  void commitDeviceColor(CANVAS_DEVICE_PRESET_COLORS[color])
}

async function removeDevice() {
  if (!props.device) {
    return
  }

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
  <div class="flex h-full min-h-0 flex-col bg-card/80">
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
          <Badge variant="outline">{{ t('levelLabel', { state: stateLabel }) }}</Badge>
          <Badge v-if="getCanvasDeviceBoundSignal(device)" variant="outline">
            {{ getCanvasDeviceBoundSignal(device) }}
          </Badge>
          <Badge v-else-if="boundSignalCount > 0" variant="outline">
            {{ t('bindingCount', { count: boundSignalCount }) }}
          </Badge>
        </div>

        <Separator class="my-5" />

        <section class="space-y-3">
          <div>
            <p class="text-sm font-medium">{{ t('name') }}</p>
          </div>

          <Input
            v-model="deviceNameInput"
            :placeholder="t('name')"
            @blur="commitDeviceName"
            @keydown.enter.prevent="commitDeviceName"
          />
        </section>

        <Separator class="my-5" />

        <section v-if="supportsDeviceColor" class="space-y-3">
          <div>
            <p class="text-sm font-medium">{{ t('color') }}</p>
          </div>

          <div class="space-y-3">
            <div class="space-y-2">
              <label class="text-xs font-medium text-muted-foreground">
                {{ t('deviceColorPresets') }}
              </label>
              <div class="grid grid-cols-3 gap-2">
                <button
                  v-for="color in DEVICE_COLOR_OPTIONS"
                  :key="color"
                  type="button"
                  class="group flex items-center gap-2 rounded-xl border px-2 py-2 text-left transition-colors hover:border-primary/40 hover:bg-muted/60"
                  :class="
                    normalizeCanvasDeviceColor(deviceColorInput) ===
                    CANVAS_DEVICE_PRESET_COLORS[color]
                      ? 'border-primary/50 bg-primary/5'
                      : 'border-border/70 bg-background/70'
                  "
                  @click="applyPresetDeviceColor(color)"
                >
                  <span
                    class="h-4 w-4 shrink-0 rounded-full border border-black/10 shadow-sm"
                    :style="{ backgroundColor: CANVAS_DEVICE_PRESET_COLORS[color] }"
                  />
                  <span class="truncate text-xs font-medium">{{ t(color) }}</span>
                </button>
              </div>
            </div>

            <div class="space-y-2">
              <label class="text-xs font-medium text-muted-foreground">
                {{ t('customColor') }}
              </label>
              <div
                class="flex items-center gap-3 rounded-xl border border-border/70 bg-background/70 px-3 py-2"
              >
                <input
                  :value="deviceColorInput"
                  type="color"
                  class="h-9 w-12 cursor-pointer rounded-md border border-border bg-transparent p-0"
                  @input="commitDeviceColor(($event.target as HTMLInputElement).value)"
                />
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-medium text-foreground">{{ t('selectedColor') }}</p>
                  <p class="truncate text-xs text-muted-foreground">
                    {{ normalizeCanvasDeviceColor(deviceColorInput) ?? deviceColorInput }}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <Separator v-if="supportsDeviceColor" class="my-5" />

        <section v-if="isButtonDevice && buttonConfig" class="space-y-3">
          <div>
            <p class="text-sm font-medium">{{ t('activeLevel') }}</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              {{ t('buttonActiveLevelDescription') }}
            </p>
          </div>

          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">
              {{ t('pressedSignalLevel') }}
            </label>
            <Select :model-value="buttonPolarityInput" @update:model-value="commitButtonPolarity">
              <SelectTrigger class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="ACTIVE_HIGH">{{ t('high') }}</SelectItem>
                <SelectItem :value="ACTIVE_LOW">{{ t('low') }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <Separator v-if="isButtonDevice && buttonConfig" class="my-5" />

        <section v-if="isSegmentDisplayDevice && segmentDisplayConfig" class="space-y-3">
          <div>
            <p class="text-sm font-medium">{{ t('digits') }}</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              {{ t('digitsDescription') }}
            </p>
          </div>

          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground" for="segment-digits">
              {{ t('digitCount') }}
            </label>
            <Input
              id="segment-digits"
              v-model="segmentDigitsInput"
              type="number"
              :min="SEGMENT_DIGITS_MIN"
              :max="SEGMENT_DIGITS_MAX"
              step="1"
              @blur="commitSegmentDigits"
              @keydown.enter.prevent="commitSegmentDigits"
            />
          </div>

          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground">
              {{ t('litSignalLevel') }}
            </label>
            <Select :model-value="segmentPolarityInput" @update:model-value="commitSegmentPolarity">
              <SelectTrigger class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem :value="ACTIVE_HIGH">{{ t('high') }}</SelectItem>
                <SelectItem :value="ACTIVE_LOW">{{ t('low') }}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </section>

        <Separator v-if="isSegmentDisplayDevice && segmentDisplayConfig" class="my-5" />

        <section v-if="isMatrixDevice && matrixDimensions" class="space-y-3">
          <div>
            <p class="text-sm font-medium">{{ t('matrixSize') }}</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              {{ t('matrixSizeDescription') }}
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-xs font-medium text-muted-foreground" for="matrix-rows">
                {{ t('rows') }}
              </label>
              <Input
                id="matrix-rows"
                v-model="matrixRowsInput"
                type="number"
                :min="MATRIX_DIMENSION_MIN"
                :max="MATRIX_DIMENSION_MAX"
                step="1"
                @blur="commitMatrixDimensions"
                @keydown.enter.prevent="commitMatrixDimensions"
              />
            </div>
            <div class="space-y-1">
              <label class="text-xs font-medium text-muted-foreground" for="matrix-columns">
                {{ t('columns') }}
              </label>
              <Input
                id="matrix-columns"
                v-model="matrixColumnsInput"
                type="number"
                :min="MATRIX_DIMENSION_MIN"
                :max="MATRIX_DIMENSION_MAX"
                step="1"
                @blur="commitMatrixDimensions"
                @keydown.enter.prevent="commitMatrixDimensions"
              />
            </div>
          </div>
        </section>

        <Separator v-if="isMatrixDevice && matrixDimensions" class="my-5" />

        <section class="space-y-3">
          <div>
            <p class="text-sm font-medium">{{ t('portBinding') }}</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              {{ t('portBindingDescription') }}
            </p>
          </div>

          <div
            v-if="isMatrixDevice && matrixDimensions"
            class="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-3"
          >
            <div>
              <p class="text-sm font-medium">{{ t('quickBind') }}</p>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                {{ t('quickBindDescription') }}
              </p>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">
                  {{ t('rowBus') }}
                </label>
                <Select v-model="matrixRowBusInput">
                  <SelectTrigger class="w-full">
                    <SelectValue :placeholder="t('chooseBus')" />
                  </SelectTrigger>
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
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">
                  {{ t('columnBus') }}
                </label>
                <Select v-model="matrixColumnBusInput">
                  <SelectTrigger class="w-full">
                    <SelectValue :placeholder="t('chooseBus')" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      v-for="bus in matrixColumnBusOptions"
                      :key="`matrix-col-${bus.baseName}`"
                      :value="bus.baseName"
                    >
                      <span class="font-mono text-xs">{{ bus.label }}</span>
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              variant="secondary"
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
            v-if="isSegmentDisplayDevice && segmentDisplayConfig"
            class="space-y-3 rounded-2xl border border-border/70 bg-muted/20 p-3"
          >
            <div>
              <p class="text-sm font-medium">{{ t('quickBind') }}</p>
              <p class="mt-1 text-xs leading-5 text-muted-foreground">
                {{ t('quickBindDescription') }}
              </p>
            </div>

            <div class="space-y-3">
              <div class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">
                  {{ t('segmentBus') }}
                </label>
                <Select v-model="segmentBusInput">
                  <SelectTrigger class="w-full">
                    <SelectValue :placeholder="t('chooseBus')" />
                  </SelectTrigger>
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

              <div v-if="segmentDisplayConfig.digits > 1" class="space-y-1">
                <label class="text-xs font-medium text-muted-foreground">
                  {{ t('digitSelectBus') }}
                </label>
                <Select v-model="segmentDigitBusInput">
                  <SelectTrigger class="w-full">
                    <SelectValue :placeholder="t('chooseBus')" />
                  </SelectTrigger>
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
              variant="secondary"
              class="w-full"
              :disabled="
                !segmentBusInput || (segmentDisplayConfig.digits > 1 && !segmentDigitBusInput)
              "
              @click="applySegmentBusBindings"
            >
              {{ t('applyBusBindings') }}
            </Button>

            <p
              v-if="
                segmentBusOptions.length === 0 ||
                (segmentDisplayConfig.digits > 1 && segmentDigitBusOptions.length === 0)
              "
              class="text-xs leading-5 text-muted-foreground"
            >
              {{ t('noMatchingBuses') }}
            </p>
          </div>

          <div v-if="hasSlotBindings" class="space-y-3">
            <div v-for="(slot, slotIndex) in bindingSlots" :key="slot.key" class="space-y-1">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>{{ slot.label }}</span>
                <span class="font-mono">{{
                  slotBindingValue(slotIndex) === UNBOUND_SIGNAL
                    ? t('unbound')
                    : slotBindingValue(slotIndex)
                }}</span>
              </div>
              <Select
                :model-value="slotBindingValue(slotIndex)"
                @update:model-value="(value) => handleSlotBindingUpdate(slotIndex, value)"
              >
                <SelectTrigger class="w-full">
                  <SelectValue :placeholder="t('chooseSignalFor', { label: slot.label })" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="UNBOUND_SIGNAL">{{ t('noBinding') }}</SelectItem>
                  <SelectItem
                    v-for="signal in compatibleSignals"
                    :key="`${slot.key}-${signal.name}`"
                    :value="signal.name"
                  >
                    <div class="flex w-full items-center gap-2">
                      <span class="font-mono text-xs">{{ signal.bindingLabel }}</span>
                      <span
                        class="ml-auto text-[11px] uppercase tracking-wide text-muted-foreground"
                      >
                        {{ formatSignalDirection(signal.direction) }}
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Select v-else :model-value="bindingValue" @update:model-value="handleBindingUpdate">
            <SelectTrigger class="w-full">
              <SelectValue :placeholder="t('chooseTopLevelPort')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="UNBOUND_SIGNAL">{{ t('noBinding') }}</SelectItem>
              <SelectItem
                v-for="signal in compatibleSignals"
                :key="signal.name"
                :value="signal.name"
              >
                <div class="flex w-full items-center gap-2">
                  <span class="font-mono text-xs">{{ signal.bindingLabel }}</span>
                  <span class="ml-auto text-[11px] uppercase tracking-wide text-muted-foreground">
                    {{ formatSignalDirection(signal.direction) }}
                  </span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          <p v-if="compatibleSignals.length === 0" class="text-xs leading-5 text-amber-600">
            {{ t('noCompatiblePorts') }}
          </p>
        </section>

        <Separator class="my-5" />

        <section class="space-y-3">
          <div>
            <p class="text-sm font-medium">{{ t('quickFacts') }}</p>
          </div>

          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-2xl border border-border bg-background p-3">
              <p class="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                {{ t('position') }}
              </p>
              <p class="mt-2 font-medium">{{ Math.round(device.x) }}, {{ Math.round(device.y) }}</p>
            </div>
            <div class="rounded-2xl border border-border bg-background p-3">
              <p class="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                {{ t('signal') }}
              </p>
              <p class="mt-2 font-medium">
                {{
                  boundSignalCount > 0 ? t('boundCount', { count: boundSignalCount }) : t('unbound')
                }}
              </p>
            </div>
            <div
              v-if="isSegmentDisplayDevice && segmentDisplayConfig"
              class="rounded-2xl border border-border bg-background p-3"
            >
              <p class="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                {{ t('digits') }}
              </p>
              <p class="mt-2 font-medium">
                {{ segmentDisplayConfig.digits }}
              </p>
            </div>
            <div
              v-if="isMatrixDevice && matrixDimensions"
              class="rounded-2xl border border-border bg-background p-3"
            >
              <p class="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
                {{ t('matrixLabel') }}
              </p>
              <p class="mt-2 font-medium">
                {{ matrixDimensions.columns }} x {{ matrixDimensions.rows }}
              </p>
            </div>
          </div>
        </section>

        <div class="mt-auto pt-6">
          <div class="rounded-2xl border border-border bg-muted/40 p-4">
            <p class="flex items-center gap-2 text-sm font-medium">
              <CheckCircle2 class="h-4 w-4 text-emerald-600" />
              {{ t('workbenchActions') }}
            </p>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">
              {{ t('workbenchActionsDescription') }}
            </p>
          </div>

          <div class="mt-4 flex gap-2">
            <Button
              variant="outline"
              class="flex-1 gap-2"
              :disabled="boundSignalCount === 0"
              @click="clearBinding"
            >
              <Unplug class="h-4 w-4" />
              {{ t('clearBinding') }}
            </Button>
            <Button variant="destructive" class="gap-2" @click="removeDevice">
              <Trash2 class="h-4 w-4" />
              {{ t('remove') }}
            </Button>
          </div>
        </div>
      </div>

      <div v-else class="flex min-h-full flex-col justify-between p-5">
        <div>
          <div
            class="grid h-12 w-12 place-items-center rounded-2xl border border-dashed border-border bg-muted/30"
          >
            <Link2 class="h-5 w-5 text-muted-foreground" />
          </div>
          <h3 class="mt-4 text-lg font-semibold">{{ t('deviceInspector') }}</h3>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">
            {{ t('deviceInspectorDescription') }}
          </p>
        </div>

        <div class="rounded-2xl border border-border bg-muted/40 p-4">
          <p class="text-xs uppercase tracking-[0.24em] text-muted-foreground">
            {{ t('howItWorks') }}
          </p>
          <div class="mt-3 space-y-2 text-sm text-foreground/90">
            <p>{{ t('howItWorksStep1') }}</p>
            <p>{{ t('howItWorksStep2') }}</p>
            <p>{{ t('howItWorksStep3') }}</p>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
