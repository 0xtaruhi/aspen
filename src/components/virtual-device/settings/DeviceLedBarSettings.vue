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
import { getCanvasLedBarConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import { clampInspectorInt, resizeCanvasSlotBindings } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()
const { t } = useI18n()

const config = computed(() => getCanvasLedBarConfig(props.device))
const widthInput = ref('8')

watch(
  () => config.value?.width ?? 8,
  (width) => {
    widthInput.value = String(width)
  },
  { immediate: true },
)

function commitLedBarWidth() {
  const width = clampInspectorInt(widthInput.value, config.value?.width ?? 8, 1, 32)
  widthInput.value = String(width)

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      binding: resizeCanvasSlotBindings(props.device, width),
      config: {
        kind: 'led_bar',
        width,
        active_low: config.value?.activeLow ?? false,
      },
    },
  })
}

function commitLedBarPolarity(value: string) {
  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      config: {
        kind: 'led_bar',
        width: config.value?.width ?? 8,
        active_low: value === 'low',
      },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">{{ t('ledBar') }}</p>
    <Input
      v-model="widthInput"
      type="number"
      min="1"
      max="32"
      @blur="commitLedBarWidth"
      @keydown.enter.prevent="commitLedBarWidth"
    />
    <Select
      :model-value="(config?.activeLow ?? false) ? 'low' : 'high'"
      @update:model-value="(value) => commitLedBarPolarity(String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="high">{{ t('activeHigh') }}</SelectItem>
        <SelectItem value="low">{{ t('activeLow') }}</SelectItem>
      </SelectContent>
    </Select>
  </section>
</template>
