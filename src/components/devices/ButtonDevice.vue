<script setup lang="ts">
defineProps<{
  isOn?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle', value: boolean): void
}>()

function press() {
  emit('toggle', true)
}

function release() {
  emit('toggle', false)
}
</script>

<template>
  <button
    type="button"
    class="w-12 h-12 rounded-full border-2 transition-colors shadow-inner"
    :class="isOn ? 'bg-sky-500/30 border-sky-400' : 'bg-zinc-800 border-zinc-600'"
    @pointerdown.prevent="press"
    @pointerup="release"
    @pointerleave="release"
    @pointercancel="release"
  >
    <span class="sr-only">Toggle button</span>
  </button>
</template>
