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
      class="w-12 h-20 bg-zinc-800 rounded-lg border border-zinc-700 shadow-inner flex flex-col items-center justify-between p-2 cursor-pointer"
      @click="toggle"
    >
      <!-- Screw top -->
      <div class="w-2 h-2 rounded-full bg-zinc-600 shadow-inner"></div>

      <!-- Switch Body -->
      <div class="relative w-8 h-12 bg-black/50 rounded border border-zinc-700">
        <!-- Toggle Lever -->
        <div
          class="absolute left-1 w-6 h-6 bg-zinc-300 rounded shadow-lg transition-all duration-200"
          :class="isOn ? 'top-1 bg-green-500/20' : 'bottom-1 bg-red-500/20'"
        >
          <div
            class="w-full h-full bg-gradient-to-b from-zinc-200 to-zinc-400 rounded border border-zinc-500"
          ></div>
        </div>
      </div>

      <!-- Screw bottom -->
      <div class="w-2 h-2 rounded-full bg-zinc-600 shadow-inner"></div>
    </div>
  </div>
</template>
