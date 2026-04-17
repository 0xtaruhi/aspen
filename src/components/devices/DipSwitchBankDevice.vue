<script setup lang="ts">
import { cn } from '@/lib/utils'

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
        class="device-panel-shell flex h-[72px] flex-col items-center justify-between rounded-md px-1 py-2"
        @click.stop="toggleBit(index - 1)"
      >
        <span class="text-[10px] font-medium text-[var(--device-panel-label)]">{{
          index - 1
        }}</span>
        <span
          :class="
            cn(
              'device-panel-slot relative flex h-9 w-5 items-center rounded-full px-0.5',
              bitValue(index - 1) ? 'justify-start' : 'justify-end',
            )
          "
        >
          <span
            :class="
              cn(
                'flex h-4 w-4 items-center justify-center rounded-full transition-transform',
                bitValue(index - 1) ? 'bg-emerald-300' : 'bg-zinc-300',
              )
            "
          >
            <span class="device-metal-cap h-3 w-3 rounded-full" />
          </span>
        </span>
        <span
          :class="
            cn(
              'text-[10px] font-semibold',
              bitValue(index - 1) ? 'text-emerald-300' : 'device-panel-label-dim',
            )
          "
        >
          {{ bitValue(index - 1) ? 'ON' : 'OFF' }}
        </span>
      </button>
    </div>
  </div>
</template>
