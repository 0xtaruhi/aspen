<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  isOn?: boolean
  color?: string
}>()

const glowColor = computed(() => {
  switch (props.color) {
    case 'red':
      return 'rgba(239, 68, 68, 0.6)'
    case 'green':
      return 'rgba(34, 197, 94, 0.6)'
    case 'blue':
      return 'rgba(59, 130, 246, 0.6)'
    case 'yellow':
      return 'rgba(234, 179, 8, 0.6)'
    default:
      return 'rgba(239, 68, 68, 0.6)' // Default red
  }
})

const baseColor = computed(() => {
  switch (props.color) {
    case 'red':
      return 'bg-red-500'
    case 'green':
      return 'bg-green-500'
    case 'blue':
      return 'bg-blue-500'
    case 'yellow':
      return 'bg-yellow-500'
    default:
      return 'bg-red-500'
  }
})
</script>

<template>
  <div class="w-full h-full flex items-center justify-center">
    <div
      class="w-8 h-8 rounded-full border-2 border-zinc-700 transition-all duration-200"
      :class="[isOn ? baseColor : 'bg-zinc-800', isOn ? 'shadow-[0_0_15px_rgba(0,0,0,0.5)]' : '']"
      :style="{ boxShadow: isOn ? `0 0 20px ${glowColor}` : 'none' }"
    >
      <!-- Inner reflection/highlight for realism -->
      <div class="w-2 h-2 bg-white/20 rounded-full ml-1 mt-1"></div>
    </div>
  </div>
</template>
