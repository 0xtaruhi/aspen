<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { Input } from '@/components/ui/input'
import { getCanvasBitsetData, getCanvasDipSwitchBankConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import { clampInspectorInt, resizeCanvasSlotBindings } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()
const { t } = useI18n()

const config = computed(() => getCanvasDipSwitchBankConfig(props.device))
const widthInput = ref('8')
const currentBits = computed(() => {
  return getCanvasBitsetData(props.device, config.value?.width ?? 8)
    .map((bit) => (bit ? 1 : 0))
    .join('')
})

watch(
  () => config.value?.width ?? 8,
  (width) => {
    widthInput.value = String(width)
  },
  { immediate: true },
)

function commitDipWidth() {
  const width = clampInspectorInt(widthInput.value, config.value?.width ?? 8, 1, 32)
  const bits = getCanvasBitsetData(props.device, width).slice(0, width)
  widthInput.value = String(width)

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      binding: resizeCanvasSlotBindings(props.device, width),
      config: { kind: 'dip_switch_bank', width },
      data: { kind: 'bitset', bits },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">{{ t('dipSwitchBank') }}</p>
    <Input
      v-model="widthInput"
      type="number"
      min="1"
      max="32"
      @blur="commitDipWidth"
      @keydown.enter.prevent="commitDipWidth"
    />
    <p class="text-xs text-muted-foreground">{{ t('currentBits') }}: {{ currentBits }}</p>
  </section>
</template>
