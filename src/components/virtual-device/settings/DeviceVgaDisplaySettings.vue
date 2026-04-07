<script setup lang="ts">
import { computed } from 'vue'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { VGA_DISPLAY_RESOLUTION_PRESETS, getCanvasVgaDisplayConfig } from '@/lib/canvas-devices'
import type { CanvasDeviceSnapshot, CanvasVgaColorMode } from '@/lib/hardware-client'
import { hardwareStore } from '@/stores/hardware'
import { clampInspectorInt, resizeCanvasSlotBindings, vgaSlotCount } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()

const config = computed(() => getCanvasVgaDisplayConfig(props.device))

function commitVgaResolution(value: string) {
  const [columnsRaw, rowsRaw] = value.split('x')
  const columns = clampInspectorInt(columnsRaw, config.value?.columns ?? 320, 1, 2048)
  const rows = clampInspectorInt(rowsRaw, config.value?.rows ?? 240, 1, 2048)

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      config: {
        kind: 'vga_display',
        columns,
        rows,
        color_mode: config.value?.colorMode ?? 'rgb332',
      },
    },
  })
}

function commitVgaColorMode(value: string) {
  if (!['mono', 'rgb111', 'rgb332', 'rgb444', 'rgb565', 'rgb888'].includes(value)) {
    return
  }

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      binding: resizeCanvasSlotBindings(props.device, vgaSlotCount(value as CanvasVgaColorMode)),
      config: {
        kind: 'vga_display',
        columns: config.value?.columns ?? 320,
        rows: config.value?.rows ?? 240,
        color_mode: value as CanvasVgaColorMode,
      },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">VGA display</p>
    <Select
      :model-value="`${config?.columns ?? 320}x${config?.rows ?? 240}`"
      @update:model-value="(value) => commitVgaResolution(String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem
          v-for="preset in VGA_DISPLAY_RESOLUTION_PRESETS"
          :key="preset.key"
          :value="`${preset.columns}x${preset.rows}`"
        >
          {{ preset.columns }} × {{ preset.rows }}
        </SelectItem>
      </SelectContent>
    </Select>
    <Select
      :model-value="config?.colorMode ?? 'rgb332'"
      @update:model-value="(value) => commitVgaColorMode(String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="mono">Mono</SelectItem>
        <SelectItem value="rgb111">RGB111</SelectItem>
        <SelectItem value="rgb332">RGB332</SelectItem>
        <SelectItem value="rgb444">RGB444</SelectItem>
        <SelectItem value="rgb565">RGB565</SelectItem>
        <SelectItem value="rgb888">RGB888</SelectItem>
      </SelectContent>
    </Select>
  </section>
</template>
