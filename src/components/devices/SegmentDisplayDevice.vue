<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  title?: string
  segmentMask?: number
  digitSegmentMasks?: number[]
}>()

const digits = computed(() => {
  if (props.digitSegmentMasks && props.digitSegmentMasks.length > 0) {
    return props.digitSegmentMasks
  }

  return [props.segmentMask ?? 0]
})

function segmentOn(mask: number, bitIndex: number) {
  return (mask & (1 << bitIndex)) !== 0
}
</script>

<template>
  <div
    class="flex h-full w-full items-center justify-center overflow-hidden rounded-md bg-zinc-950/90 px-1 py-0.5"
  >
    <div class="flex items-center justify-center gap-1.5">
      <div
        v-for="(mask, digitIndex) in digits"
        :key="digitIndex"
        class="relative h-16 w-9 rounded-md border border-zinc-800 bg-black/70"
      >
        <div
          class="absolute left-1.5 top-1 h-1 w-6 rounded-full"
          :class="
            segmentOn(mask, 0)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute right-1 top-1.5 h-6 w-1 rounded-full"
          :class="
            segmentOn(mask, 1)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute right-1 bottom-2 h-6 w-1 rounded-full"
          :class="
            segmentOn(mask, 2)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute left-1.5 bottom-1 h-1 w-6 rounded-full"
          :class="
            segmentOn(mask, 3)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute left-1 bottom-2 h-6 w-1 rounded-full"
          :class="
            segmentOn(mask, 4)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute left-1 top-1.5 h-6 w-1 rounded-full"
          :class="
            segmentOn(mask, 5)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute left-1.5 top-7.5 h-1 w-6 rounded-full"
          :class="
            segmentOn(mask, 6)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute bottom-1.5 right-0.5 h-1.5 w-1.5 rounded-full"
          :class="
            segmentOn(mask, 7)
              ? 'bg-rose-300 shadow-[0_0_8px_rgba(253,164,175,0.75)]'
              : 'bg-zinc-700'
          "
        />
      </div>
    </div>
  </div>
</template>
