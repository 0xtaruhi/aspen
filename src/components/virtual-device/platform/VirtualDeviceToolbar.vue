<script setup lang="ts">
import { Activity, Hand, LayoutGrid, Play, ScanSearch, Square } from 'lucide-vue-next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useI18n } from '@/lib/i18n'

import type { CanvasInteractionMode } from './types'

const props = defineProps<{
  interactionMode: CanvasInteractionMode
  streamRunning: boolean
  configuredSignalCount: number
  visibleSignalCount: number
  availableSignalCount: number
  actualHzLabel: string
  rateInput: string | number
  canApplySettings: boolean
  canToggleStream: boolean
  waveformPanelOpen: boolean
}>()

const emit = defineEmits<{
  (e: 'toggleGallery'): void
  (e: 'update:interactionMode', value: CanvasInteractionMode): void
  (e: 'update:rateInput', value: string | number): void
  (e: 'applySettings'): void
  (e: 'toggleStream'): void
  (e: 'toggleWaveformPanel'): void
}>()

const { t } = useI18n()
</script>

<template>
  <div class="app-toolbar-glass h-12 px-4 flex items-center gap-3">
    <div class="-ml-1 flex items-center gap-1">
      <Button
        type="button"
        size="icon"
        variant="outline"
        :aria-label="t('toggleComponentGallery')"
        @pointerdown.stop
        @click.stop="emit('toggleGallery')"
      >
        <LayoutGrid class="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        :variant="props.interactionMode === 'pan' ? 'default' : 'outline'"
        :aria-label="t('canvasPanTool')"
        :aria-pressed="props.interactionMode === 'pan'"
        @click="emit('update:interactionMode', 'pan')"
      >
        <Hand class="h-4 w-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        :variant="props.interactionMode === 'select' ? 'default' : 'outline'"
        :aria-label="t('canvasSelectTool')"
        :aria-pressed="props.interactionMode === 'select'"
        @click="emit('update:interactionMode', 'select')"
      >
        <ScanSearch class="h-4 w-4" />
      </Button>
    </div>
    <Badge variant="outline">
      {{ props.configuredSignalCount || props.visibleSignalCount }} /
      {{ props.availableSignalCount }}
      {{ t('portsUnit') }}
    </Badge>
    <Badge variant="outline">{{ props.actualHzLabel }}</Badge>
    <div class="ml-auto flex items-center gap-2">
      <Button
        type="button"
        size="icon"
        :variant="props.waveformPanelOpen ? 'default' : 'outline'"
        :aria-label="t('toggleWaveformPanel')"
        :aria-pressed="props.waveformPanelOpen"
        @click="emit('toggleWaveformPanel')"
      >
        <Activity class="h-4 w-4" />
      </Button>
      <div class="flex items-center gap-2 rounded-md border border-border bg-background px-2">
        <span class="text-xs text-muted-foreground">Hz</span>
        <Input
          :model-value="props.rateInput"
          type="number"
          min="0.1"
          step="1"
          class="h-8 w-24 border-0 bg-transparent px-0 text-right shadow-none focus-visible:ring-0"
          @update:model-value="(value) => emit('update:rateInput', value)"
          @keydown.enter.prevent="props.canApplySettings && emit('applySettings')"
        />
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        :disabled="!props.canApplySettings"
        @click="emit('applySettings')"
      >
        {{ t('apply') }}
      </Button>
      <Button
        type="button"
        size="sm"
        :variant="props.streamRunning ? 'destructive' : 'default'"
        :disabled="!props.canToggleStream"
        class="gap-2"
        @click="emit('toggleStream')"
      >
        <Square v-if="props.streamRunning" class="h-4 w-4" />
        <Play v-else class="h-4 w-4" />
        {{ props.streamRunning ? t('stop') : t('start') }}
      </Button>
    </div>
  </div>
</template>
