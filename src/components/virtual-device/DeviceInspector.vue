<script setup lang="ts">
import type { VerilogPort } from '@/lib/verilog-parser'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'

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
  deviceDrivesSignal,
  deviceReceivesSignal,
  getCanvasDeviceBoundSignal,
  getCanvasDeviceBoundSignalCount,
  getCanvasDeviceBoundSignals,
  getCanvasDeviceBindingSlots,
  getCanvasMatrixDimensions,
  getCanvasSegmentDisplayConfig,
  isCanvasMatrixDevice,
  isCanvasSegmentDisplayDevice,
} from '@/lib/canvas-devices'
import { confirmAction } from '@/lib/confirm-action'
import { hardwareStore } from '@/stores/hardware'
import { settingsStore } from '@/stores/settings'
import { signalCatalogStore } from '@/stores/signal-catalog'

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

const matrixRowsInput = ref('')
const matrixColumnsInput = ref('')
const segmentDigitsInput = ref('')

const capabilityLabel = computed(() => {
  if (!props.device) {
    return ''
  }

  const drives = deviceDrivesSignal(props.device.type)
  const receives = deviceReceivesSignal(props.device.type)

  if (drives && !receives) {
    return 'Drives FPGA input'
  }

  if (receives && !drives) {
    return 'Observes FPGA output'
  }

  return 'Bidirectional device'
})

const compatibleSignals = computed<readonly VerilogPort[]>(() => {
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

const isSegmentDisplayDevice = computed(() => {
  return props.device ? isCanvasSegmentDisplayDevice(props.device.type) : false
})

const boundSignalCount = computed(() => {
  if (!props.device) {
    return 0
  }

  return getCanvasDeviceBoundSignalCount(props.device)
})

const liveLevel = computed(() => {
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
    return 'Idle'
  }

  return liveLevel.value ? 'High' : 'Low'
})

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
    }
  },
  (nextSegmentState) => {
    segmentDigitsInput.value = nextSegmentState?.digits ? String(nextSegmentState.digits) : ''
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
      },
    },
  })
}

async function removeDevice() {
  if (!props.device) {
    return
  }

  if (
    settingsStore.state.confirmDelete &&
    !(await confirmAction(`Are you sure you want to delete ${props.device.label}?`, {
      title: 'Delete Device',
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
          <Badge variant="outline">Level: {{ stateLabel }}</Badge>
          <Badge v-if="getCanvasDeviceBoundSignal(device)" variant="outline">
            {{ getCanvasDeviceBoundSignal(device) }}
          </Badge>
          <Badge v-else-if="boundSignalCount > 0" variant="outline">
            {{ boundSignalCount }} bindings
          </Badge>
        </div>

        <Separator class="my-5" />

        <section v-if="isSegmentDisplayDevice && segmentDisplayConfig" class="space-y-3">
          <div>
            <p class="text-sm font-medium">Digits</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              Resize the display and keep any overlapping segment and digit-select bindings.
            </p>
          </div>

          <div class="space-y-1">
            <label class="text-xs font-medium text-muted-foreground" for="segment-digits">
              Digit count
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
        </section>

        <Separator v-if="isSegmentDisplayDevice && segmentDisplayConfig" class="my-5" />

        <section v-if="isMatrixDevice && matrixDimensions" class="space-y-3">
          <div>
            <p class="text-sm font-medium">Matrix Size</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              Resize the matrix and keep any overlapping row and column bindings.
            </p>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div class="space-y-1">
              <label class="text-xs font-medium text-muted-foreground" for="matrix-rows">
                Rows
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
                Columns
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
            <p class="text-sm font-medium">Port Binding</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              Bind this device against compatible ports from the current top module.
            </p>
          </div>

          <div v-if="hasSlotBindings" class="space-y-3">
            <div v-for="(slot, slotIndex) in bindingSlots" :key="slot.key" class="space-y-1">
              <div class="flex items-center justify-between text-xs text-muted-foreground">
                <span>{{ slot.label }}</span>
                <span class="font-mono">{{
                  slotBindingValue(slotIndex) === UNBOUND_SIGNAL
                    ? 'Unbound'
                    : slotBindingValue(slotIndex)
                }}</span>
              </div>
              <Select
                :model-value="slotBindingValue(slotIndex)"
                @update:model-value="(value) => handleSlotBindingUpdate(slotIndex, value)"
              >
                <SelectTrigger class="w-full">
                  <SelectValue :placeholder="`Choose signal for ${slot.label}`" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem :value="UNBOUND_SIGNAL">No binding</SelectItem>
                  <SelectItem
                    v-for="signal in compatibleSignals"
                    :key="`${slot.key}-${signal.name}`"
                    :value="signal.name"
                  >
                    <div class="flex w-full items-center gap-2">
                      <span class="font-mono text-xs">{{ signal.name }}</span>
                      <span
                        class="ml-auto text-[11px] uppercase tracking-wide text-muted-foreground"
                      >
                        {{ signal.direction }}
                      </span>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Select v-else :model-value="bindingValue" @update:model-value="handleBindingUpdate">
            <SelectTrigger class="w-full">
              <SelectValue placeholder="Choose a top-level port" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem :value="UNBOUND_SIGNAL">No binding</SelectItem>
              <SelectItem
                v-for="signal in compatibleSignals"
                :key="signal.name"
                :value="signal.name"
              >
                <div class="flex w-full items-center gap-2">
                  <span class="font-mono text-xs">{{ signal.name }}</span>
                  <span class="ml-auto text-[11px] uppercase tracking-wide text-muted-foreground">
                    {{ signal.direction }}
                  </span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>

          <p v-if="compatibleSignals.length === 0" class="text-xs leading-5 text-amber-600">
            No compatible ports were found on the current top module.
          </p>
        </section>

        <Separator class="my-5" />

        <section class="space-y-3">
          <div>
            <p class="text-sm font-medium">Quick Facts</p>
          </div>

          <div class="grid grid-cols-2 gap-3 text-sm">
            <div class="rounded-2xl border border-border bg-background p-3">
              <p class="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Position</p>
              <p class="mt-2 font-medium">{{ Math.round(device.x) }}, {{ Math.round(device.y) }}</p>
            </div>
            <div class="rounded-2xl border border-border bg-background p-3">
              <p class="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Signal</p>
              <p class="mt-2 font-medium">
                {{ boundSignalCount > 0 ? `${boundSignalCount} bound` : 'Unbound' }}
              </p>
            </div>
            <div
              v-if="isSegmentDisplayDevice && segmentDisplayConfig"
              class="rounded-2xl border border-border bg-background p-3"
            >
              <p class="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Digits</p>
              <p class="mt-2 font-medium">
                {{ segmentDisplayConfig.digits }}
              </p>
            </div>
            <div
              v-if="isMatrixDevice && matrixDimensions"
              class="rounded-2xl border border-border bg-background p-3"
            >
              <p class="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">Matrix</p>
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
              Workbench Actions
            </p>
            <p class="mt-2 text-xs leading-5 text-muted-foreground">
              Drag from the gallery to place devices. Drag the top handle strip to move. Use
              <span class="font-mono">Alt + drag</span> or middle mouse to pan the canvas.
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
              Clear Binding
            </Button>
            <Button variant="destructive" class="gap-2" @click="removeDevice">
              <Trash2 class="h-4 w-4" />
              Remove
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
          <h3 class="mt-4 text-lg font-semibold">Device Inspector</h3>
          <p class="mt-2 text-sm leading-6 text-muted-foreground">
            Select a device on the canvas to bind it to a top-level port and inspect its state.
          </p>
        </div>

        <div class="rounded-2xl border border-border bg-muted/40 p-4">
          <p class="text-xs uppercase tracking-[0.24em] text-muted-foreground">How it works</p>
          <div class="mt-3 space-y-2 text-sm text-foreground/90">
            <p>1. Open the gallery and drop a device onto the canvas.</p>
            <p>2. Click the device to focus it.</p>
            <p>3. Bind it here against ports from the current top module.</p>
          </div>
        </div>
      </div>
    </ScrollArea>
  </div>
</template>
