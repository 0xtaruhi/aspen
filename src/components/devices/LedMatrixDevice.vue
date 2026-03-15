<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title?: string
  pixels?: number[]
  columns: number
  rows: number
}>()

const pixelValues = computed(() => {
  const total = props.columns * props.rows
  if (!props.pixels || props.pixels.length === 0) {
    return Array.from({ length: total }, () => 0)
  }

  return Array.from({ length: total }, (_, index) => props.pixels?.[index] ?? 0)
})

const cellSizePx = computed(() => 12)

const cellGapPx = computed(() => 3)

const gridStyle = computed(() => {
  return {
    gridTemplateColumns: `repeat(${props.columns}, ${cellSizePx.value}px)`,
    gap: `${cellGapPx.value}px`,
  }
})

function pixelStyle(intensity: number) {
  const alpha = Math.max(0.08, intensity / 255)
  return {
    backgroundColor:
      intensity > 0 ? `rgba(34, 197, 94, ${alpha.toFixed(3)})` : 'rgba(39, 39, 42, 0.65)',
    boxShadow: intensity > 0 ? `0 0 8px rgba(74, 222, 128, ${(alpha * 0.8).toFixed(3)})` : 'none',
  }
}
</script>

<template>
  <div class="rounded-md border border-zinc-700 bg-zinc-950/90 p-2">
    <div class="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-500">
      {{ title }}
    </div>
    <div class="inline-grid rounded-md border border-zinc-800 bg-black/70 p-2" :style="gridStyle">
      <div
        v-for="(pixel, index) in pixelValues"
        :key="index"
        class="rounded-[2px] border border-zinc-900/70"
        :style="{
          width: `${cellSizePx}px`,
          height: `${cellSizePx}px`,
          ...pixelStyle(pixel),
        }"
      />
    </div>
  </div>
</template>
