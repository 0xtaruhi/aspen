<script setup lang="ts">
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
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
  canvasDeviceSupportsColor,
  getCanvasDeviceBindingAssistantComponent,
  getCanvasDeviceSettingsComponent,
} from '@/components/virtual-device/registry'
import type { IndexedSignalBus } from '@/components/virtual-device/types'
import {
  CANVAS_DEVICE_PRESET_COLORS,
  deviceDrivesSignal,
  deviceReceivesSignal,
  getCanvasDeviceBindingSlots,
  normalizeCanvasDeviceColor,
  resolveCanvasDeviceColor,
} from '@/lib/canvas-devices'
import { confirmAction } from '@/lib/confirm-action'
import { useI18n } from '@/lib/i18n'
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

const { t } = useI18n()
const nameInput = ref('')
const colorInput = ref(CANVAS_DEVICE_PRESET_COLORS.red)

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

const settingsComponent = computed(() => {
  if (!props.device) {
    return null
  }

  return getCanvasDeviceSettingsComponent(props.device.type)
})

const bindingAssistantComponent = computed(() => {
  if (!props.device) {
    return null
  }

  return getCanvasDeviceBindingAssistantComponent(props.device.type)
})

const liveLevel = computed(() => {
  if (!props.device || !hardwareStore.dataStreamStatus.value.running) {
    return false
  }

  const telemetry = hardwareStore.deviceTelemetry.value[props.device.id]
  return telemetry?.latest ?? false
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

watch(
  () => props.device,
  (device) => {
    nameInput.value = device?.label ?? ''
    colorInput.value = device
      ? (resolveCanvasDeviceColor(device) ?? CANVAS_DEVICE_PRESET_COLORS.red)
      : CANVAS_DEVICE_PRESET_COLORS.red
  },
  { immediate: true },
)

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

function commitName() {
  if (!props.device) {
    return
  }

  const nextLabel = nameInput.value.trim() || props.device.label
  if (nextLabel === props.device.label) {
    return
  }

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    label: nextLabel,
  })
}

function commitColor(value: string) {
  if (!props.device) {
    return
  }

  const nextColor = normalizeCanvasDeviceColor(value)
  if (!nextColor) {
    return
  }

  colorInput.value = nextColor
  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      color: nextColor,
    },
  })
}

function commitSingleBinding(value: string) {
  if (!props.device || props.device.state.binding.kind !== 'single') {
    return
  }

  void hardwareStore.bindCanvasSignal(props.device.id, value === UNBOUND_SIGNAL ? null : value)
}

function commitSlotBinding(slotIndex: number, value: string) {
  if (!props.device || props.device.state.binding.kind !== 'slots') {
    return
  }

  void hardwareStore.bindCanvasSignalSlot(
    props.device.id,
    slotIndex,
    value === UNBOUND_SIGNAL ? null : value,
  )
}

function clearBindings() {
  if (!props.device) {
    return
  }

  if (props.device.state.binding.kind === 'single') {
    commitSingleBinding(UNBOUND_SIGNAL)
    return
  }

  bindingSlots.value.forEach((_, index) => {
    commitSlotBinding(index, UNBOUND_SIGNAL)
  })
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

        <Separator v-if="canvasDeviceSupportsColor(device.type)" class="my-5" />

        <section v-if="canvasDeviceSupportsColor(device.type)" class="space-y-3">
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

        <Separator class="my-5" />

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
          <component
            :is="bindingAssistantComponent"
            v-if="bindingAssistantComponent"
            :device="device"
            :indexed-compatible-buses="indexedCompatibleBuses"
          />

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

        <Separator v-if="settingsComponent" class="my-5" />

        <component :is="settingsComponent" v-if="settingsComponent" :device="device" />

        <Separator class="my-5" />

        <div class="flex gap-2">
          <Button variant="outline" class="flex-1" @click="clearBindings">
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
