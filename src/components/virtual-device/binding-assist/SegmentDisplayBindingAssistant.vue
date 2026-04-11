<script setup lang="ts">
import { computed } from 'vue'

import IndexedBusBindingAssistant from '@/components/virtual-device/binding-assist/IndexedBusBindingAssistant.vue'
import type { IndexedBusBindingGroup, IndexedSignalBus } from '@/components/virtual-device/types'
import { getCanvasSegmentDisplayConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  device: CanvasDeviceSnapshot
  indexedCompatibleBuses: IndexedSignalBus[]
}>()

const { t } = useI18n()

const groups = computed<IndexedBusBindingGroup[]>(() => {
  const digits = getCanvasSegmentDisplayConfig(props.device)?.digits ?? 1

  return [
    {
      key: 'segments',
      label: t('segmentBus'),
      width: 8,
      slotOffset: 0,
      keywords: ['segment', 'seg'],
    },
    {
      key: 'digits',
      label: t('digitSelectBus'),
      width: digits > 1 ? digits : 0,
      slotOffset: 8,
      keywords: ['digit', 'sel'],
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
