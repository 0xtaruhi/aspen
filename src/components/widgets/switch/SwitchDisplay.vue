<template>
  <div class="flex h-full items-center justify-center">
    <Switch :checked="Boolean(state.power)" class="h-10 w-16" @update:checked="onToggle" />
  </div>
</template>

<script setup lang="ts">
import { Switch } from '@/components/ui/switch'

type SwitchState = {
  power?: boolean
  label?: string
  description?: string
}

defineProps<{ state: SwitchState }>()
const emit = defineEmits<{ (e: 'update', patch: Partial<SwitchState>): void }>()

function onToggle(value: boolean) {
  emit('update', { power: value })
}
</script>
