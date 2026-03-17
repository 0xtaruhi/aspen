<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  isOn?: boolean
  color?: string
}>()

function normalizeHexColor(value: string | undefined) {
  const normalized = value?.trim().toLowerCase()
  const hexMatch = normalized?.match(/^#([0-9a-f]{6})$/)
  if (!hexMatch) {
    return '#ef4444'
  }

  return `#${hexMatch[1]}`
}

function hexToRgb(value: string) {
  const normalized = normalizeHexColor(value)
  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
  }
}

const baseColor = computed(() => normalizeHexColor(props.color))

const glowColor = computed(() => {
  const { red, green, blue } = hexToRgb(baseColor.value)
  return `rgba(${red}, ${green}, ${blue}, 0.6)`
})
</script>

<template>
  <div class="w-full h-full flex items-center justify-center">
    <div
      class="w-8 h-8 rounded-full border-2 border-zinc-700 transition-all duration-200"
      :class="[isOn ? 'shadow-[0_0_15px_rgba(0,0,0,0.5)]' : '']"
      :style="{
        backgroundColor: isOn ? baseColor : '#27272a',
        boxShadow: isOn ? `0 0 20px ${glowColor}` : 'none',
      }"
    >
      <!-- Inner reflection/highlight for realism -->
      <div class="w-2 h-2 bg-white/20 rounded-full ml-1 mt-1"></div>
    </div>
  </div>
</template>
