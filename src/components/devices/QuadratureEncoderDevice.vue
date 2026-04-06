<script setup lang="ts">
const props = defineProps<{
  phase: number
  hasButton: boolean
  buttonPressed: boolean
}>()

const emit = defineEmits<{
  (e: 'rotate', delta: number): void
  (e: 'toggle-button', value: boolean): void
}>()
</script>

<template>
  <div class="flex h-full w-full items-center justify-center gap-5 px-4 py-3">
    <button
      type="button"
      class="grid h-9 w-9 place-items-center rounded-md border border-border bg-background text-sm font-semibold"
      @click.stop="emit('rotate', -1)"
    >
      ↺
    </button>

    <div
      class="relative flex h-24 w-24 items-center justify-center rounded-full border border-zinc-700 bg-[radial-gradient(circle_at_30%_28%,rgba(255,255,255,0.22),rgba(82,82,91,0.08),rgba(24,24,27,0.98)_72%)] shadow-[inset_0_-10px_24px_rgba(0,0,0,0.4),0_10px_28px_rgba(0,0,0,0.22)]"
    >
      <div
        class="absolute h-10 w-1.5 -translate-y-6 rounded-full bg-amber-300 transition-transform"
        :style="{ transform: `rotate(${(props.phase % 4) * 90}deg) translateY(-24px)` }"
      />
      <button
        v-if="props.hasButton"
        type="button"
        class="h-9 w-9 rounded-full border transition-colors"
        :class="
          props.buttonPressed ? 'border-sky-400 bg-sky-500/30' : 'border-zinc-600 bg-zinc-900'
        "
        @pointerdown.stop.prevent="emit('toggle-button', true)"
        @pointerup.stop="emit('toggle-button', false)"
        @pointerleave="emit('toggle-button', false)"
        @pointercancel="emit('toggle-button', false)"
      />
    </div>

    <button
      type="button"
      class="grid h-9 w-9 place-items-center rounded-md border border-border bg-background text-sm font-semibold"
      @click.stop="emit('rotate', 1)"
    >
      ↻
    </button>
  </div>
</template>
