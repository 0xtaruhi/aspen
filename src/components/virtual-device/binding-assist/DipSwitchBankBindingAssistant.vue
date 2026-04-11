<script setup lang="ts">
import { computed } from 'vue'

import IndexedBusBindingAssistant from '@/components/virtual-device/binding-assist/IndexedBusBindingAssistant.vue'
import type { IndexedBusBindingGroup, IndexedSignalBus } from '@/components/virtual-device/types'
import { getCanvasDipSwitchBankConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  device: CanvasDeviceSnapshot
  indexedCompatibleBuses: IndexedSignalBus[]
}>()

const { t } = useI18n()

const groups = computed<IndexedBusBindingGroup[]>(() => {
  const width = getCanvasDipSwitchBankConfig(props.device)?.width ?? 0

  return [
    {
      key: 'switches',
      label: t('switchBus'),
      width,
      slotOffset: 0,
      keywords: ['switch', 'sw', 'dip', 'key'],
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
