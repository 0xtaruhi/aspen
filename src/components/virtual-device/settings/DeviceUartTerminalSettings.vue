<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { Input } from '@/components/ui/input'
import { getCanvasUartTerminalConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { hardwareStore } from '@/stores/hardware'
import { clampInspectorInt } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()

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
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">UART terminal</p>
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
