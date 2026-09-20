<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getCanvasUartTerminalConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot, CanvasUartMode } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import { clampInspectorInt, remapCanvasSlotBindings } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()
const { t } = useI18n()

const config = computed(() => getCanvasUartTerminalConfig(props.device))
const cyclesInput = ref('16')

watch(
  () => config.value?.cyclesPerBit ?? 16,
  (cycles) => {
    cyclesInput.value = String(cycles)
  },
  { immediate: true },
)

function commitUartCycles() {
  const cyclesPerBit = clampInspectorInt(
    cyclesInput.value,
    config.value?.cyclesPerBit ?? 16,
    1,
    4096,
  )
  cyclesInput.value = String(cyclesPerBit)

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      config: {
        kind: 'uart_terminal',
        cycles_per_bit: cyclesPerBit,
        mode: config.value?.mode ?? 'tx_rx',
      },
    },
  })
}

function commitUartMode(value: string) {
  if (value !== 'tx' && value !== 'rx' && value !== 'tx_rx') {
    return
  }

  const nextConfig = {
    kind: 'uart_terminal' as const,
    cycles_per_bit: config.value?.cyclesPerBit ?? 16,
    mode: value as CanvasUartMode,
  }
  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      binding: remapCanvasSlotBindings(props.device, nextConfig),
      config: nextConfig,
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">{{ t('uartTerminal') }}</p>
    <p class="text-sm font-medium">{{ t('uartMode') }}</p>
    <Select
      :model-value="config?.mode ?? 'tx_rx'"
      @update:model-value="(value) => commitUartMode(String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="tx">{{ t('uartTxOnly') }}</SelectItem>
        <SelectItem value="rx">{{ t('uartRxOnly') }}</SelectItem>
        <SelectItem value="tx_rx">{{ t('uartTxRx') }}</SelectItem>
      </SelectContent>
    </Select>
    <p class="text-sm font-medium">{{ t('cyclesPerBit') }}</p>
    <Input
      v-model="cyclesInput"
      type="number"
      min="1"
      max="4096"
      @blur="commitUartCycles"
      @keydown.enter.prevent="commitUartCycles"
    />
  </section>
</template>
