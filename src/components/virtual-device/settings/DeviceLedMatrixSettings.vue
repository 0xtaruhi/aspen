<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { Input } from '@/components/ui/input'
import { getCanvasMatrixDimensions } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { hardwareStore } from '@/stores/hardware'
import { clampInspectorInt, resizeCanvasSlotBindings } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()

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

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      binding: resizeCanvasSlotBindings(props.device, rows + columns),
      config: { kind: 'led_matrix', rows, columns },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">LED matrix</p>
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
  </section>
</template>
