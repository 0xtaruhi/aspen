<template>
  <div
    class="flex h-full flex-col rounded-2xl border border-zinc-200/60 bg-white/90 transition dark:border-zinc-700/60 dark:bg-zinc-900/80"
  >
    <div class="shrink-0 h-9 px-2 flex items-center justify-between widget-drag-handle cursor-move">
      <div class="text-sm font-medium truncate text-zinc-900 dark:text-zinc-100 ml-1 select-none">
        {{ title }}
      </div>
      <button
        class="inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-200/60 dark:border-zinc-800/60 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-transform duration-150 hover:rotate-90"
        @click.stop="onOpenSettings"
        aria-label="Open settings"
      >
        <Settings class="h-4 w-4" />
      </button>
    </div>
    <div class="shrink-0 h-px bg-zinc-200/80 dark:bg-white/8" />
    <div class="p-2 flex-1 min-h-0 overflow-auto">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Settings } from 'lucide-vue-next'

type Props = { title: string }

defineProps<Props>()

const emit = defineEmits<{ (e: 'open-settings'): void; (e: 'remove'): void }>()

function onOpenSettings() {
  emit('open-settings')
}
</script>
