<template>
  <div class="py-4 text-sm text-zinc-500 dark:text-zinc-400">
    This switch does not expose configurable settings.
  </div>
</template>

<script setup lang="ts">
type SwitchState = {
  power?: boolean
}

defineProps<{ state: SwitchState }>()
defineEmits<{ (e: 'update', patch: Partial<SwitchState>): void }>()
</script>
