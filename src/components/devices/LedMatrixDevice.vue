<script setup lang="ts">
import { computed } from 'vue'

import {
  MATRIX_CELL_GAP_PX,
  MATRIX_CELL_SIZE_PX,
  MATRIX_GRID_PADDING_PX,
  MATRIX_OUTER_PADDING_PX,
} from '@/lib/device-shell-metrics'

const props = defineProps<{
  pixels?: number[]
  columns: number
  rows: number
  color?: string
}>()

const pixelValues = computed(() => {
  const total = props.columns * props.rows
  if (!props.pixels || props.pixels.length === 0) {
    return Array.from({ length: total }, () => 0)
  }

  return Array.from({ length: total }, (_, index) => props.pixels?.[index] ?? 0)
})

const gridStyle = computed(() => {
  return {
    gridTemplateColumns: `repeat(${props.columns}, ${MATRIX_CELL_SIZE_PX}px)`,
    gap: `${MATRIX_CELL_GAP_PX}px`,
    padding: `${MATRIX_GRID_PADDING_PX}px`,
  }
})

function parseRgbChannels(value: string | undefined) {
  if (!value) {
    return { on: '74, 222, 128', glow: '74, 222, 128' }
  }

  const normalized = value.trim().toLowerCase()
  const hexMatch = normalized.match(/^#([0-9a-f]{6})$/)
  if (!hexMatch) {
    return { on: '74, 222, 128', glow: '74, 222, 128' }
  }

  const hex = hexMatch[1]
  const red = Number.parseInt(hex.slice(0, 2), 16)
  const green = Number.parseInt(hex.slice(2, 4), 16)
  const blue = Number.parseInt(hex.slice(4, 6), 16)

  const glow = [
    Math.min(255, Math.round(red + (255 - red) * 0.25)),
    Math.min(255, Math.round(green + (255 - green) * 0.25)),
    Math.min(255, Math.round(blue + (255 - blue) * 0.25)),
  ]

  return {
    on: `${red}, ${green}, ${blue}`,
    glow: `${glow[0]}, ${glow[1]}, ${glow[2]}`,
  }
}

function pixelStyle(intensity: number) {
  const alpha = Math.max(0.1, intensity / 255)
  const color = parseRgbChannels(props.color)
  return {
    backgroundColor:
      intensity > 0 ? `rgba(${color.on}, ${alpha.toFixed(3)})` : 'rgba(82, 82, 91, 0.42)',
    boxShadow:
      intensity > 0 ? `0 0 10px rgba(${color.glow}, ${(alpha * 0.85).toFixed(3)})` : 'none',
  }
}
</script>

<template>
  <div
    class="flex h-full w-full items-center justify-center"
    :style="{ padding: `${MATRIX_OUTER_PADDING_PX}px` }"
  >
    <div
      class="inline-grid rounded-xl bg-[linear-gradient(180deg,rgba(16,16,20,0.98),rgba(8,8,12,0.98))] shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"
      :style="gridStyle"
    >
      <div
        v-for="(pixel, index) in pixelValues"
        :key="index"
        class="rounded-full"
        :style="{
          width: `${MATRIX_CELL_SIZE_PX}px`,
          height: `${MATRIX_CELL_SIZE_PX}px`,
          ...pixelStyle(pixel),
        }"
      />
    </div>
  </div>
</template>
