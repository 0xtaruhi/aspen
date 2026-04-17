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
  <div class="w-full h-full flex items-center justify-center" @dblclick.stop>
    <div
      class="device-panel-shell flex h-20 w-12 cursor-pointer flex-col items-center justify-between rounded-lg p-2"
      @click="toggle"
    >
      <!-- Screw top -->
      <div class="device-metal-dot h-2 w-2 rounded-full"></div>

      <!-- Switch Body -->
      <div class="device-panel-slot relative h-12 w-8 rounded">
        <!-- Toggle Lever -->
        <div
          class="switch-lever absolute left-1 h-6 w-6 rounded transition-all duration-200"
          :class="isOn ? 'top-1' : 'bottom-1'"
        >
          <div class="device-metal-cap h-full w-full rounded"></div>
        </div>
      </div>

      <!-- Screw bottom -->
      <div class="device-metal-dot h-2 w-2 rounded-full"></div>
    </div>
  </div>
</template>

<style scoped>
.switch-lever {
  background: color-mix(in oklab, var(--muted) 70%, var(--background) 30%);
  box-shadow: 0 6px 10px color-mix(in oklab, black 20%, transparent);
}
</style>
