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
  <div class="w-full min-w-24 rounded-md border border-zinc-700 bg-zinc-950/90 p-2">
    <div class="mb-2 text-[10px] font-medium uppercase tracking-[0.22em] text-zinc-500">
      {{ title }}
    </div>
    <div class="flex items-center justify-center gap-2">
      <div
        v-for="(mask, digitIndex) in digits"
        :key="digitIndex"
        class="relative h-14 w-8 rounded-md border border-zinc-800 bg-black/70"
      >
        <div
          class="absolute left-1.5 top-1 h-1 w-5 rounded-full"
          :class="
            segmentOn(mask, 0)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute right-1 top-1.5 h-5 w-1 rounded-full"
          :class="
            segmentOn(mask, 1)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute right-1 bottom-2 h-5 w-1 rounded-full"
          :class="
            segmentOn(mask, 2)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute left-1.5 bottom-1 h-1 w-5 rounded-full"
          :class="
            segmentOn(mask, 3)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute left-1 bottom-2 h-5 w-1 rounded-full"
          :class="
            segmentOn(mask, 4)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute left-1 top-1.5 h-5 w-1 rounded-full"
          :class="
            segmentOn(mask, 5)
              ? 'bg-rose-400 shadow-[0_0_10px_rgba(251,113,133,0.65)]'
              : 'bg-zinc-800'
          "
        />
        <div
          class="absolute left-1.5 top-6.5 h-1 w-5 rounded-full"
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
