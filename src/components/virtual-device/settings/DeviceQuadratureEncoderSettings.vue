<script setup lang="ts">
import { computed } from 'vue'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getCanvasQuadratureEncoderConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import { resizeCanvasSlotBindings } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()
const { t } = useI18n()

const config = computed(() => getCanvasQuadratureEncoderConfig(props.device))

function commitQuadratureHasButton(value: string) {
  const hasButton = value === 'yes'
  const data =
    props.device.state.data.kind === 'quadrature_encoder'
      ? props.device.state.data
      : { kind: 'quadrature_encoder' as const, phase: 0, button_pressed: false }

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      binding: resizeCanvasSlotBindings(props.device, hasButton ? 3 : 2),
      config: {
        kind: 'quadrature_encoder',
        has_button: hasButton,
      },
      data: {
        kind: 'quadrature_encoder',
        phase: data.phase,
        button_pressed: hasButton ? data.button_pressed : false,
      },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">{{ t('quadratureEncoder') }}</p>
    <Select
      :model-value="(config?.hasButton ?? true) ? 'yes' : 'no'"
      @update:model-value="(value) => commitQuadratureHasButton(String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="yes">{{ t('withPushButton') }}</SelectItem>
        <SelectItem value="no">{{ t('abOnly') }}</SelectItem>
      </SelectContent>
    </Select>
  </section>
</template>
