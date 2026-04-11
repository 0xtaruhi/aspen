<script setup lang="ts">
import { computed } from 'vue'

import IndexedBusBindingAssistant from '@/components/virtual-device/binding-assist/IndexedBusBindingAssistant.vue'
import type { IndexedBusBindingGroup, IndexedSignalBus } from '@/components/virtual-device/types'
import { getCanvasMatrixKeypadConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  device: CanvasDeviceSnapshot
  indexedCompatibleBuses: IndexedSignalBus[]
}>()

const { t } = useI18n()

const groups = computed<IndexedBusBindingGroup[]>(() => {
  const config = getCanvasMatrixKeypadConfig(props.device)
  const rows = config?.rows ?? 0
  const columns = config?.columns ?? 0

  return [
    {
      key: 'rows',
      label: t('rowBus'),
      width: rows,
      slotOffset: 0,
      keywords: ['row'],
    },
    {
      key: 'columns',
      label: t('columnBus'),
      width: columns,
      slotOffset: rows,
      keywords: ['column', 'col'],
    },
  ]
})
</script>

<template>
  <IndexedBusBindingAssistant
    :device="props.device"
    :indexed-compatible-buses="props.indexedCompatibleBuses"
    :groups="groups"
  />
</template>
