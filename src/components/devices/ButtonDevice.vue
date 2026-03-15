<script setup lang="ts">
import { useI18n } from '@/lib/i18n'

defineProps<{
  isOn?: boolean
}>()

const emit = defineEmits<{
  (e: 'toggle', value: boolean): void
}>()
const { t } = useI18n()

function press() {
  emit('toggle', true)
}

function release() {
  emit('toggle', false)
}
</script>

<template>
  <div class="flex items-center justify-center">
    <button
      type="button"
      class="h-12 w-12 rounded-full border-2 shadow-inner transition-colors"
      :class="isOn ? 'border-sky-400 bg-sky-500/30' : 'border-zinc-600 bg-zinc-800'"
      @pointerdown.prevent="press"
      @pointerup="release"
      @pointerleave="release"
      @pointercancel="release"
    >
      <span class="sr-only">{{ t('toggleButton') }}</span>
    </button>
  </div>
</template>
