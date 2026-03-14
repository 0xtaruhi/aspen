<script setup lang="ts">
const props = defineProps<{
  title: string
  isOn?: boolean
  interactive?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle', value: boolean): void
}>()

function toggle() {
  if (!props.interactive) {
    return
  }

  emit('toggle', !props.isOn)
}
</script>

<template>
  <button
    type="button"
    class="w-full min-w-24 rounded-md border p-2 text-left transition-colors"
    :class="
      interactive
        ? 'cursor-pointer border-zinc-600 bg-zinc-900/80 hover:border-zinc-400'
        : 'cursor-default border-zinc-700 bg-zinc-900/70'
    "
    @click="toggle"
  >
    <div class="flex items-center gap-2">
      <div
        class="h-2.5 w-2.5 rounded-full transition-colors"
        :class="isOn ? 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]' : 'bg-zinc-600'"
      ></div>
      <div class="min-w-0 flex-1 text-[10px] font-medium leading-tight text-zinc-200">
        {{ title }}
      </div>
      <div
        class="rounded-full px-1.5 py-0.5 text-[9px] uppercase tracking-[0.2em]"
        :class="isOn ? 'bg-emerald-500/15 text-emerald-300' : 'bg-zinc-800 text-zinc-400'"
      >
        {{ isOn ? 'High' : 'Low' }}
      </div>
    </div>

    <div
      class="mt-2 rounded border transition-colors"
      :class="isOn ? 'border-emerald-400/40 bg-emerald-500/10' : 'border-zinc-700 bg-zinc-800/80'"
    >
      <div
        class="h-8 rounded-[inherit]"
        :class="
          interactive
            ? isOn
              ? 'bg-[linear-gradient(135deg,rgba(16,185,129,0.22),rgba(56,189,248,0.12))]'
              : 'bg-[linear-gradient(135deg,rgba(24,24,27,0.9),rgba(39,39,42,0.7))]'
            : isOn
              ? 'bg-[radial-gradient(circle_at_top,rgba(56,189,248,0.35),rgba(16,185,129,0.15),transparent_75%)]'
              : 'bg-[linear-gradient(180deg,rgba(24,24,27,0.92),rgba(39,39,42,0.74))]'
        "
      ></div>
    </div>

    <div v-if="interactive" class="mt-2 text-[9px] uppercase tracking-[0.22em] text-zinc-400">
      Click to drive {{ isOn ? 'low' : 'high' }}
    </div>
  </button>
</template>
