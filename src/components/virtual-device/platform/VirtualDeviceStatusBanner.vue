<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '@/lib/i18n'

const props = defineProps<{
  streamMessage: string
  streamLastError: string | null
  droppedSamples: number
  showBacklogWarning: boolean
  streamScheduleLagMs: number
  streamSignalOverflow: number
  hasSelectedSource: boolean
  hasAnySynthesisSignals: boolean
  hasStaleSynthesisSignals: boolean
}>()

const { t } = useI18n()

const roundedLagMs = computed(() => Math.round(props.streamScheduleLagMs))
const showBanner = computed(() => {
  return (
    Boolean(props.streamMessage) ||
    Boolean(props.streamLastError) ||
    props.droppedSamples > 0 ||
    props.showBacklogWarning ||
    props.streamSignalOverflow > 0 ||
    (props.hasSelectedSource && !props.hasAnySynthesisSignals) ||
    props.hasStaleSynthesisSignals
  )
})
</script>

<template>
  <div
    v-if="showBanner"
    class="border-b border-border bg-background px-4 py-2 text-xs text-muted-foreground"
  >
    <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span v-if="props.streamLastError" class="text-destructive">
        {{ props.streamLastError }}
      </span>
      <span v-else-if="props.streamMessage" class="text-destructive">
        {{ props.streamMessage }}
      </span>
      <span v-if="props.droppedSamples > 0" class="text-amber-600">
        {{ t('streamDroppedWarning', { count: props.droppedSamples }) }}
      </span>
      <span v-if="props.showBacklogWarning" class="text-amber-600">
        {{ t('streamLagWarning', { ms: roundedLagMs }) }}
      </span>
      <span v-if="props.streamSignalOverflow > 0" class="text-amber-600">
        {{ t('streamOverflowWarning', { count: props.streamSignalOverflow }) }}
      </span>
      <span v-if="props.hasSelectedSource && !props.hasAnySynthesisSignals" class="text-amber-600">
        {{ t('workbenchRequiresSynthesisDescription') }}
      </span>
      <span v-else-if="props.hasStaleSynthesisSignals" class="text-amber-600">
        {{ t('workbenchSynthesisOutdatedDescription') }}
      </span>
    </div>
  </div>
</template>
