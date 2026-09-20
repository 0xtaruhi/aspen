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
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import { clampInspectorInt, remapCanvasSlotBindings } from './shared'

const props = defineProps<{ device: CanvasDeviceSnapshot }>()
const { t } = useI18n()

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
        hsync_active_low: config.value?.hsyncActiveLow ?? true,
        vsync_active_low: config.value?.vsyncActiveLow ?? true,
      },
    },
  })
}

function commitVgaColorMode(value: string) {
  if (!['mono', 'rgb111', 'rgb332', 'rgb444', 'rgb565', 'rgb888'].includes(value)) {
    return
  }

  const nextConfig = {
    kind: 'vga_display' as const,
    columns: config.value?.columns ?? 320,
    rows: config.value?.rows ?? 240,
    color_mode: value as CanvasVgaColorMode,
    hsync_active_low: config.value?.hsyncActiveLow ?? true,
    vsync_active_low: config.value?.vsyncActiveLow ?? true,
  }
  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      binding: remapCanvasSlotBindings(props.device, nextConfig),
      config: nextConfig,
    },
  })
}

function commitSyncPolarity(target: 'hsync' | 'vsync', value: string) {
  const current = config.value
  if (!current) {
    return
  }

  void hardwareStore.upsertCanvasDevice({
    ...props.device,
    state: {
      ...props.device.state,
      config: {
        kind: 'vga_display',
        columns: current.columns,
        rows: current.rows,
        color_mode: current.colorMode,
        hsync_active_low: target === 'hsync' ? value === 'low' : current.hsyncActiveLow,
        vsync_active_low: target === 'vsync' ? value === 'low' : current.vsyncActiveLow,
      },
    },
  })
}
</script>

<template>
  <section class="space-y-3">
    <p class="text-sm font-medium">{{ t('vgaDisplay') }}</p>
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
        <SelectItem value="mono">{{ t('vgaColorModeMono') }}</SelectItem>
        <SelectItem value="rgb111">{{ t('vgaColorModeRgb111') }}</SelectItem>
        <SelectItem value="rgb332">{{ t('vgaColorModeRgb332') }}</SelectItem>
        <SelectItem value="rgb444">{{ t('vgaColorModeRgb444') }}</SelectItem>
        <SelectItem value="rgb565">{{ t('vgaColorModeRgb565') }}</SelectItem>
        <SelectItem value="rgb888">{{ t('vgaColorModeRgb888') }}</SelectItem>
      </SelectContent>
    </Select>
    <p class="text-sm font-medium">{{ t('hsyncPolarity') }}</p>
    <Select
      :model-value="(config?.hsyncActiveLow ?? true) ? 'low' : 'high'"
      @update:model-value="(value) => commitSyncPolarity('hsync', String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="low">{{ t('activeLow') }}</SelectItem>
        <SelectItem value="high">{{ t('activeHigh') }}</SelectItem>
      </SelectContent>
    </Select>
    <p class="text-sm font-medium">{{ t('vsyncPolarity') }}</p>
    <Select
      :model-value="(config?.vsyncActiveLow ?? true) ? 'low' : 'high'"
      @update:model-value="(value) => commitSyncPolarity('vsync', String(value))"
    >
      <SelectTrigger class="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="low">{{ t('activeLow') }}</SelectItem>
        <SelectItem value="high">{{ t('activeHigh') }}</SelectItem>
      </SelectContent>
    </Select>
  </section>
</template>
