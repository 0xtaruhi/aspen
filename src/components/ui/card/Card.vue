<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="card"
    :class="
      cn(
        'app-card-surface text-card-foreground flex flex-col gap-6 rounded-xl border py-6',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>

<style scoped>
.app-card-surface {
  background: var(--window-card-surface);
}
</style>
