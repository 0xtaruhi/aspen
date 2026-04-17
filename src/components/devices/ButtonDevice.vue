<script setup lang="ts">
import { useI18n } from '@/lib/i18n'
import { cn } from '@/lib/utils'

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
      :class="
        cn(
          'device-panel-shell device-button-shell h-14 w-14 rounded-full border-2 transition-colors',
          isOn && 'device-button-shell-active',
        )
      "
      @pointerdown.prevent="press"
      @pointerup="release"
      @pointerleave="release"
      @pointercancel="release"
    >
      <span class="sr-only">{{ t('toggleButton') }}</span>
    </button>
  </div>
</template>

<style scoped>
.device-button-shell {
  box-shadow:
    inset 0 2px 10px color-mix(in oklab, white 8%, transparent),
    inset 0 -10px 18px color-mix(in oklab, black 20%, transparent);
}

.device-button-shell-active {
  border-color: color-mix(in oklab, var(--primary) 58%, white 42%);
  background:
    radial-gradient(
      circle at 35% 30%,
      color-mix(in oklab, white 12%, transparent),
      transparent 18px
    ),
    color-mix(in oklab, var(--primary) 22%, var(--device-panel-surface));
}
</style>
