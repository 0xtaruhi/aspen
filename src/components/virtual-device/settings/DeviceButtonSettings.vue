<script setup lang="ts">
import { computed } from 'vue'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getCanvasButtonConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()
const { t } = useI18n()

const activeLevel = computed(() =>
  (getCanvasButtonConfig(props.device)?.activeLow ?? false) ? 'low' : 'high',
)

function commitButtonPolarity(value: string) {
  if (props.device.state.config.kind !== 'button') {
    return
  }

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      config: {
        kind: 'button',
        active_low: value === 'low',
      },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">{{ t('activeLevel') }}</p>
    <Select
      :model-value="activeLevel"
      @update:model-value="(value) => commitButtonPolarity(String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="high">{{ t('activeHigh') }}</SelectItem>
        <SelectItem value="low">{{ t('activeLow') }}</SelectItem>
      </SelectContent>
    </Select>
  </section>
</template>
