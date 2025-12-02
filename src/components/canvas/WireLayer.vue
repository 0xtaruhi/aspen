<script setup lang="ts">
type Wire = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
  color?: string
}

defineProps<{
  wires: Wire[]
}>()

// Simple bezier curve calculation
function getPath(w: Wire) {
  const dx = Math.abs(w.x1 - w.x2)
  const cp1x = w.x1 + dx * 0.5
  const cp2x = w.x2 - dx * 0.5
  return `M ${w.x1} ${w.y1} C ${cp1x} ${w.y1}, ${cp2x} ${w.y2}, ${w.x2} ${w.y2}`
}
</script>

<template>
  <svg class="absolute inset-0 pointer-events-none overflow-visible">
    <path
      v-for="wire in wires"
      :key="wire.id"
      :d="getPath(wire)"
      fill="none"
      :stroke="wire.color || 'var(--primary)'"
      stroke-width="2"
      class="opacity-80"
    />
  </svg>
</template>
