<script setup lang="ts">
import { Minus, Square, X } from 'lucide-vue-next'

import { runWindowAction } from '@/lib/window-frame'

const controls = [
  [
    'minimize',
    'Minimize window',
    'Minimize',
    Minus,
    'h-4 w-4',
    'hover:bg-accent/72 hover:text-accent-foreground',
  ],
  [
    'toggleMaximize',
    'Toggle maximize window',
    'Maximize',
    Square,
    'h-3.5 w-3.5',
    'hover:bg-accent/72 hover:text-accent-foreground',
  ],
  [
    'close',
    'Close window',
    'Close',
    X,
    'h-4 w-4',
    'hover:bg-destructive hover:text-destructive-foreground',
  ],
] as const
</script>

<template>
  <div
    class="inline-flex items-center gap-1 rounded-full border border-border/45 bg-muted/55 p-1"
    data-window-control
    aria-label="Window controls"
    @mousedown.stop
    @dblclick.stop
  >
    <button
      v-for="[action, label, title, icon, iconClass, className] in controls"
      :key="action"
      type="button"
      :class="[
        'grid h-8 w-8 place-items-center rounded-md text-foreground/70 transition-colors',
        className,
      ]"
      :aria-label="label"
      :title="title"
      @click="runWindowAction(action)"
    >
      <component :is="icon" :class="iconClass" />
    </button>
  </div>
</template>
