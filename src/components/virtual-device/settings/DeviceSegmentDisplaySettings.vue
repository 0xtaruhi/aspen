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
import { getCanvasSegmentDisplayConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { hardwareStore } from '@/stores/hardware'
import { clampInspectorInt, resizeCanvasSlotBindings } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()

const config = computed(() => getCanvasSegmentDisplayConfig(props.device))
const digitsInput = ref('1')

watch(
  () => config.value?.digits ?? 1,
  (digits) => {
    digitsInput.value = String(digits)
  },
  { immediate: true },
)

function commitSegmentConfig() {
  const digits = clampInspectorInt(digitsInput.value, config.value?.digits ?? 1, 1, 16)
  digitsInput.value = String(digits)
  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      binding: resizeCanvasSlotBindings(props.device, digits > 1 ? 8 + digits : 8),
      config: {
        kind: 'segment_display',
        digits,
        active_low:
          props.device.state.config.kind === 'segment_display'
            ? (props.device.state.config.active_low ?? false)
            : false,
      },
    },
  })
}

function commitSegmentPolarity(value: string) {
  const digits = config.value?.digits ?? 1
  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      config: {
        kind: 'segment_display',
        digits,
        active_low: value === 'low',
      },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">Segment display</p>
    <Input
      v-model="digitsInput"
      type="number"
      min="1"
      max="16"
      @blur="commitSegmentConfig"
      @keydown.enter.prevent="commitSegmentConfig"
    />
    <Select
      :model-value="(config?.activeLow ?? false) ? 'low' : 'high'"
      @update:model-value="(value) => commitSegmentPolarity(String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="high">Active high</SelectItem>
        <SelectItem value="low">Active low</SelectItem>
      </SelectContent>
    </Select>
  </section>
</template>
