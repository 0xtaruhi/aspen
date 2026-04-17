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

    <div class="encoder-knob relative flex h-24 w-24 items-center justify-center rounded-full">
      <div
        class="absolute h-10 w-1.5 -translate-y-6 rounded-full bg-amber-300 transition-transform"
        :style="{ transform: `rotate(${(props.phase % 4) * 90}deg) translateY(-24px)` }"
      />
      <button
        v-if="props.hasButton"
        type="button"
        class="h-9 w-9 rounded-full border transition-colors"
        :class="props.buttonPressed ? 'border-sky-400 bg-sky-500/30' : 'device-panel-slot'"
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

<style scoped>
.encoder-knob {
  border: 1px solid var(--device-panel-border);
  background: radial-gradient(
    circle at 30% 28%,
    color-mix(in oklab, white 22%, transparent),
    color-mix(in oklab, var(--device-panel-border) 14%, transparent),
    color-mix(in oklab, var(--device-panel-slot) 88%, black 12%) 72%
  );
  box-shadow:
    inset 0 -10px 24px color-mix(in oklab, black 36%, transparent),
    0 10px 28px color-mix(in oklab, black 18%, transparent);
}
</style>
