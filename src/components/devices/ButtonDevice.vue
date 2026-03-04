<script setup lang="ts">
const props = defineProps<{
  isOn?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle', value: boolean): void
}>()

function toggle() {
  emit('toggle', !props.isOn)
}
</script>

<template>
  <button
    type="button"
    class="w-12 h-12 rounded-full border-2 transition-colors shadow-inner"
    :class="isOn ? 'bg-sky-500/30 border-sky-400' : 'bg-zinc-800 border-zinc-600'"
    @click="toggle"
  >
    <span class="sr-only">Toggle button</span>
  </button>
</template>
