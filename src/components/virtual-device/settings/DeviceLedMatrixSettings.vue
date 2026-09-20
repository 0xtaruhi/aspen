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
import { getCanvasMatrixDimensions } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import { clampInspectorInt, remapCanvasSlotBindings } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()
const { t } = useI18n()

const dimensions = computed(() => getCanvasMatrixDimensions(props.device))
const rowsInput = ref('8')
const columnsInput = ref('8')

watch(
  () => ({ rows: dimensions.value?.rows ?? 8, columns: dimensions.value?.columns ?? 8 }),
  (value) => {
    rowsInput.value = String(value.rows)
    columnsInput.value = String(value.columns)
  },
  { immediate: true },
)

function commitLedMatrixConfig() {
  const rows = clampInspectorInt(rowsInput.value, dimensions.value?.rows ?? 8, 1, 64)
  const columns = clampInspectorInt(columnsInput.value, dimensions.value?.columns ?? 8, 1, 64)
  rowsInput.value = String(rows)
  columnsInput.value = String(columns)

  const nextConfig = {
    kind: 'led_matrix' as const,
    rows,
    columns,
    row_active_low: dimensions.value?.rowActiveLow ?? false,
    column_active_low: dimensions.value?.columnActiveLow ?? false,
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

function commitMatrixPolarity(target: 'row' | 'column', value: string) {
  const current = dimensions.value
  if (!current) {
    return
  }

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      config: {
        kind: 'led_matrix',
        rows: current.rows,
        columns: current.columns,
        row_active_low: target === 'row' ? value === 'low' : current.rowActiveLow,
        column_active_low: target === 'column' ? value === 'low' : current.columnActiveLow,
      },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">{{ t('ledMatrix') }}</p>
    <div class="grid grid-cols-2 gap-3">
      <Input
        v-model="rowsInput"
        type="number"
        min="1"
        max="64"
        @blur="commitLedMatrixConfig"
        @keydown.enter.prevent="commitLedMatrixConfig"
      />
      <Input
        v-model="columnsInput"
        type="number"
        min="1"
        max="64"
        @blur="commitLedMatrixConfig"
        @keydown.enter.prevent="commitLedMatrixConfig"
      />
    </div>
    <p class="text-sm font-medium">{{ t('rowSelectLevel') }}</p>
    <Select
      :model-value="(dimensions?.rowActiveLow ?? false) ? 'low' : 'high'"
      @update:model-value="(value) => commitMatrixPolarity('row', String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="high">{{ t('activeHighScan') }}</SelectItem>
        <SelectItem value="low">{{ t('activeLowScan') }}</SelectItem>
      </SelectContent>
    </Select>
    <p class="text-sm font-medium">{{ t('columnLitLevel') }}</p>
    <Select
      :model-value="(dimensions?.columnActiveLow ?? false) ? 'low' : 'high'"
      @update:model-value="(value) => commitMatrixPolarity('column', String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="high">{{ t('activeHigh') }}</SelectItem>
        <SelectItem value="low">{{ t('activeLow') }}</SelectItem>
      </SelectContent>
    </Select>
  </section>
</template>
