<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { Button } from '@/components/ui/button'
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
import type { IndexedSignalBus } from '@/components/virtual-device/types'
import { guessIndexedBus } from '@/components/virtual-device/settings/shared'

const props = defineProps<{
  device: CanvasDeviceSnapshot
  indexedCompatibleBuses: IndexedSignalBus[]
}>()

const { t } = useI18n()
const rowBusInput = ref('')
const columnBusInput = ref('')

const dimensions = computed(() => getCanvasMatrixDimensions(props.device))
const rowBusOptions = computed(() => {
  const rows = dimensions.value?.rows ?? 0
  return props.indexedCompatibleBuses.filter((bus) => bus.width >= rows)
})
const columnBusOptions = computed(() => {
  const columns = dimensions.value?.columns ?? 0
  return props.indexedCompatibleBuses.filter((bus) => bus.width >= columns)
})

function findIndexedBus(baseName: string) {
  return props.indexedCompatibleBuses.find((bus) => bus.baseName === baseName) ?? null
}

watch(
  () => ({
    id: props.device.id,
    rows: dimensions.value?.rows ?? 0,
    columns: dimensions.value?.columns ?? 0,
    buses: props.indexedCompatibleBuses.map((bus) => `${bus.baseName}:${bus.width}`).join('|'),
  }),
  () => {
    const rows = dimensions.value?.rows ?? 0
    const columns = dimensions.value?.columns ?? 0
    rowBusInput.value = guessIndexedBus(props.indexedCompatibleBuses, rows, ['row'])
    columnBusInput.value = guessIndexedBus(
      props.indexedCompatibleBuses,
      columns,
      ['info', 'col', 'column'],
      rowBusInput.value,
    )
  },
  { immediate: true },
)

async function applyBusBindings() {
  const rows = dimensions.value?.rows ?? 0
  const columns = dimensions.value?.columns ?? 0
  const rowBus = findIndexedBus(rowBusInput.value)
  const columnBus = findIndexedBus(columnBusInput.value)
  if (!rowBus || !columnBus || rows <= 0 || columns <= 0) {
    return
  }

  const operations: Promise<unknown>[] = []
  for (let rowIndex = 0; rowIndex < rows; rowIndex += 1) {
    operations.push(
      hardwareStore.bindCanvasSignalSlot(
        props.device.id,
        rowIndex,
        rowBus.signals[rowIndex] ?? null,
      ),
    )
  }

  for (let columnIndex = 0; columnIndex < columns; columnIndex += 1) {
    operations.push(
      hardwareStore.bindCanvasSignalSlot(
        props.device.id,
        rows + columnIndex,
        columnBus.signals[columnIndex] ?? null,
      ),
    )
  }

  await Promise.all(operations)
}
</script>

<template>
  <div class="space-y-3 rounded-md border border-border/70 bg-muted/20 p-3">
    <div>
      <p class="text-sm font-medium">{{ t('quickBind') }}</p>
      <p class="mt-1 text-xs leading-5 text-muted-foreground">
        {{ t('quickBindDescription') }}
      </p>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div class="space-y-1.5">
        <p class="text-xs font-medium text-muted-foreground">{{ t('rowBus') }}</p>
        <Select
          :model-value="rowBusInput"
          @update:model-value="(value) => (rowBusInput = String(value))"
        >
          <SelectTrigger class="w-full"
            ><SelectValue :placeholder="t('chooseBus')"
          /></SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="bus in rowBusOptions"
              :key="`matrix-row-${bus.baseName}`"
              :value="bus.baseName"
            >
              <span class="font-mono text-xs">{{ bus.label }}</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="space-y-1.5">
        <p class="text-xs font-medium text-muted-foreground">{{ t('columnBus') }}</p>
        <Select
          :model-value="columnBusInput"
          @update:model-value="(value) => (columnBusInput = String(value))"
        >
          <SelectTrigger class="w-full"
            ><SelectValue :placeholder="t('chooseBus')"
          /></SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="bus in columnBusOptions"
              :key="`matrix-column-${bus.baseName}`"
              :value="bus.baseName"
            >
              <span class="font-mono text-xs">{{ bus.label }}</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
    <Button
      variant="outline"
      class="w-full"
      :disabled="!rowBusInput || !columnBusInput"
      @click="applyBusBindings"
    >
      {{ t('applyBusBindings') }}
    </Button>
    <p
      v-if="rowBusOptions.length === 0 || columnBusOptions.length === 0"
      class="text-xs leading-5 text-muted-foreground"
    >
      {{ t('noMatchingBuses') }}
    </p>
  </div>
</template>
