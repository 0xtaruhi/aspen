<script setup lang="ts">
const props = defineProps<{
  width: number
  bits: boolean[]
}>()

const emit = defineEmits<{
  (e: 'toggle-bit', index: number, value: boolean): void
}>()

function bitValue(index: number) {
  return props.bits[index] ?? false
}

function toggleBit(index: number) {
  emit('toggle-bit', index, !bitValue(index))
}
</script>

<template>
  <div class="flex h-full w-full items-center justify-center px-3 py-3">
    <div
      class="grid w-full gap-2"
      :style="{ gridTemplateColumns: `repeat(${width}, minmax(0, 1fr))` }"
    >
      <button
        v-for="index in width"
        :key="index"
        type="button"
        class="flex h-18 flex-col items-center justify-between rounded-md border border-zinc-700 bg-zinc-900 px-1 py-2 shadow-inner"
        @click.stop="toggleBit(index - 1)"
      >
        <span class="text-[10px] font-medium text-zinc-400">{{ index - 1 }}</span>
        <span
          class="relative flex h-9 w-5 items-center rounded-full border border-zinc-700 bg-zinc-950 px-0.5"
          :class="bitValue(index - 1) ? 'justify-start' : 'justify-end'"
        >
          <span
            class="h-4 w-4 rounded-full border border-zinc-500 bg-zinc-300 transition-transform"
            :class="bitValue(index - 1) ? 'bg-emerald-300' : 'bg-zinc-300'"
          />
        </span>
        <span
          class="text-[10px] font-semibold"
          :class="bitValue(index - 1) ? 'text-emerald-300' : 'text-zinc-500'"
        >
          {{ bitValue(index - 1) ? 'ON' : 'OFF' }}
        </span>
      </button>
    </div>
  </div>
</template>
