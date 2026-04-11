<script setup lang="ts">
import { computed } from 'vue'

import IndexedBusBindingAssistant from '@/components/virtual-device/binding-assist/IndexedBusBindingAssistant.vue'
import type { IndexedBusBindingGroup, IndexedSignalBus } from '@/components/virtual-device/types'
import { getCanvasVgaDisplayConfig, vgaColorModeBitCounts } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  device: CanvasDeviceSnapshot
  indexedCompatibleBuses: IndexedSignalBus[]
}>()

const { t } = useI18n()

const groups = computed<IndexedBusBindingGroup[]>(() => {
  const config = getCanvasVgaDisplayConfig(props.device)
  const colorMode = config?.colorMode ?? 'rgb332'
  const { redBits, greenBits, blueBits } = vgaColorModeBitCounts(colorMode)
  const baseGroups: IndexedBusBindingGroup[] = [
    {
      key: 'hsync',
      label: t('hsyncBus'),
      width: 1,
      slotOffset: 0,
      keywords: ['hsync', 'h_sync', 'hs'],
    },
    {
      key: 'vsync',
      label: t('vsyncBus'),
      width: 1,
      slotOffset: 1,
      keywords: ['vsync', 'v_sync', 'vs'],
    },
  ]

  if (colorMode === 'mono') {
    baseGroups.push({
      key: 'pixel',
      label: t('pixelBus'),
      width: blueBits,
      slotOffset: 2,
      keywords: ['pixel', 'mono', 'gray', 'grey', 'blue'],
    })
    return baseGroups
  }

  let slotOffset = 2
  if (redBits > 0) {
    baseGroups.push({
      key: 'red',
      label: t('redBus'),
      width: redBits,
      slotOffset,
      keywords: ['red'],
    })
    slotOffset += redBits
  }
  if (greenBits > 0) {
    baseGroups.push({
      key: 'green',
      label: t('greenBus'),
      width: greenBits,
      slotOffset,
      keywords: ['green'],
    })
    slotOffset += greenBits
  }
  if (blueBits > 0) {
    baseGroups.push({
      key: 'blue',
      label: t('blueBus'),
      width: blueBits,
      slotOffset,
      keywords: ['blue'],
    })
  }

  return baseGroups
})
</script>

<template>
  <IndexedBusBindingAssistant
    :device="props.device"
    :indexed-compatible-buses="props.indexedCompatibleBuses"
    :groups="groups"
  />
</template>
