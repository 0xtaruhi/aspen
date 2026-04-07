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
import { getCanvasHd44780LcdConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot, CanvasHd44780BusMode } from '@/lib/hardware-client'
import { hardwareStore } from '@/stores/hardware'
import { clampInspectorInt, hd44780SlotCount, resizeCanvasSlotBindings } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()

const config = computed(() => getCanvasHd44780LcdConfig(props.device))
const columnsInput = ref('16')
const rowsInput = ref('2')

watch(
  () => ({ columns: config.value?.columns ?? 16, rows: config.value?.rows ?? 2 }),
  (value) => {
    columnsInput.value = String(value.columns)
    rowsInput.value = String(value.rows)
  },
  { immediate: true },
)

function commitHd44780Size() {
  const columns = clampInspectorInt(columnsInput.value, config.value?.columns ?? 16, 8, 40)
  const rows = clampInspectorInt(rowsInput.value, config.value?.rows ?? 2, 1, 4)
  columnsInput.value = String(columns)
  rowsInput.value = String(rows)

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      config: {
        kind: 'hd44780_lcd',
        columns,
        rows,
        bus_mode: config.value?.busMode ?? '4bit',
      },
    },
  })
}

function commitHd44780BusMode(value: string) {
  if (value !== '4bit' && value !== '8bit') {
    return
  }

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      binding: resizeCanvasSlotBindings(
        props.device,
        hd44780SlotCount(value as CanvasHd44780BusMode),
      ),
      config: {
        kind: 'hd44780_lcd',
        columns: config.value?.columns ?? 16,
        rows: config.value?.rows ?? 2,
        bus_mode: value as CanvasHd44780BusMode,
      },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">HD44780 LCD</p>
    <div class="grid grid-cols-2 gap-3">
      <Input
        v-model="columnsInput"
        type="number"
        min="8"
        max="40"
        @blur="commitHd44780Size"
        @keydown.enter.prevent="commitHd44780Size"
      />
      <Input
        v-model="rowsInput"
        type="number"
        min="1"
        max="4"
        @blur="commitHd44780Size"
        @keydown.enter.prevent="commitHd44780Size"
      />
    </div>
    <Select
      :model-value="config?.busMode ?? '4bit'"
      @update:model-value="(value) => commitHd44780BusMode(String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="4bit">4-bit bus</SelectItem>
        <SelectItem value="8bit">8-bit bus</SelectItem>
      </SelectContent>
    </Select>
  </section>
</template>
