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
import { getCanvasMatrixKeypadConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import { clampInspectorInt, resizeCanvasSlotBindings } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()
const { t } = useI18n()

const config = computed(() => getCanvasMatrixKeypadConfig(props.device))
const rowsInput = ref('4')
const columnsInput = ref('4')

watch(
  () => ({ rows: config.value?.rows ?? 4, columns: config.value?.columns ?? 4 }),
  (value) => {
    rowsInput.value = String(value.rows)
    columnsInput.value = String(value.columns)
  },
  { immediate: true },
)

function commitKeypadConfig() {
  const rows = clampInspectorInt(rowsInput.value, config.value?.rows ?? 4, 1, 8)
  const columns = clampInspectorInt(columnsInput.value, config.value?.columns ?? 4, 1, 8)
  rowsInput.value = String(rows)
  columnsInput.value = String(columns)

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      binding: resizeCanvasSlotBindings(props.device, rows + columns),
      config: {
        kind: 'matrix_keypad',
        rows,
        columns,
        active_low: config.value?.activeLow ?? true,
      },
    },
  })
}

function commitKeypadPolarity(value: string) {
  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      config: {
        kind: 'matrix_keypad',
        rows: config.value?.rows ?? 4,
        columns: config.value?.columns ?? 4,
        active_low: value === 'low',
      },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">{{ t('matrixKeypad') }}</p>
    <div class="grid grid-cols-2 gap-3">
      <Input
        v-model="rowsInput"
        type="number"
        min="1"
        max="8"
        @blur="commitKeypadConfig"
        @keydown.enter.prevent="commitKeypadConfig"
      />
      <Input
        v-model="columnsInput"
        type="number"
        min="1"
        max="8"
        @blur="commitKeypadConfig"
        @keydown.enter.prevent="commitKeypadConfig"
      />
    </div>
    <Select
      :model-value="(config?.activeLow ?? true) ? 'low' : 'high'"
      @update:model-value="(value) => commitKeypadPolarity(String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="low">{{ t('activeLowScan') }}</SelectItem>
        <SelectItem value="high">{{ t('activeHighScan') }}</SelectItem>
      </SelectContent>
    </Select>
  </section>
</template>
