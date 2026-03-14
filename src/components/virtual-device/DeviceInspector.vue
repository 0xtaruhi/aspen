<script setup lang="ts">
import type { VerilogPort } from '@/lib/verilog-parser'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'

import { computed } from 'vue'
import { CheckCircle2, Link2, Trash2, Unplug, X } from 'lucide-vue-next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { deviceDrivesSignal, deviceReceivesSignal } from '@/lib/canvas-devices'
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
  return props.device?.state.bound_signal ?? UNBOUND_SIGNAL
})

const stateLabel = computed(() => {
  if (!props.device) {
    return 'Idle'
  }

  return props.device.state.is_on ? 'High' : 'Low'
})

function handleBindingUpdate(value: unknown) {
  if (!props.device || typeof value !== 'string') {
    return
  }

  void hardwareStore.bindCanvasSignal(props.device.id, value === UNBOUND_SIGNAL ? null : value)
}

function clearBinding() {
  if (!props.device) {
    return
  }

  void hardwareStore.bindCanvasSignal(props.device.id, null)
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
          <Badge v-if="device.state.bound_signal" variant="outline">
            {{ device.state.bound_signal }}
          </Badge>
        </div>

        <Separator class="my-5" />

        <section class="space-y-3">
          <div>
            <p class="text-sm font-medium">Port Binding</p>
            <p class="mt-1 text-xs leading-5 text-muted-foreground">
              Bind this device against compatible ports from the current top module.
            </p>
          </div>

          <Select :model-value="bindingValue" @update:model-value="handleBindingUpdate">
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
                {{ device.state.bound_signal ? 'Bound' : 'Unbound' }}
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
              :disabled="!device.state.bound_signal"
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
