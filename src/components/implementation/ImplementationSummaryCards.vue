<script setup lang="ts">
import {
  Binary,
  CircuitBoard,
  Gauge,
  Route,
  ShieldAlert,
  Sparkles,
  SquareStack,
} from 'lucide-vue-next'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'

type SummaryCard = {
  stage: string
  title: string
  statusLabel: string
  statusDotClass: string
  durationText: string
  warningCount: number
  errorCount: number
  canViewLog: boolean
  canViewTiming: boolean
}

const props = defineProps<{
  cards: SummaryCard[]
}>()

const emit = defineEmits<{
  viewLog: [stage: string]
  viewTiming: [stage: string]
}>()

const { t } = useI18n()

function iconFor(stage: string) {
  switch (stage) {
    case 'map':
      return Binary
    case 'pack':
      return SquareStack
    case 'place':
      return CircuitBoard
    case 'route':
      return Route
    case 'sta':
      return Gauge
    case 'bitgen':
      return Sparkles
    default:
      return ShieldAlert
  }
}
</script>

<template>
  <div class="grid shrink-0 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
    <article
      v-for="card in props.cards"
      :key="card.stage"
      class="rounded-lg border border-border bg-card text-card-foreground"
    >
      <div class="flex items-center justify-between border-b border-border px-4 py-3">
        <div class="flex min-w-0 items-center gap-3">
          <div
            class="flex h-8 w-8 items-center justify-center rounded-md border border-border bg-muted"
          >
            <component :is="iconFor(card.stage)" class="h-4 w-4" />
          </div>
          <div class="min-w-0">
            <div class="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              {{ card.stage }}
            </div>
            <div class="truncate text-sm font-medium">{{ card.title }}</div>
          </div>
        </div>
        <span class="h-2 w-2 rounded-full" :class="card.statusDotClass" />
      </div>

      <div class="px-4 py-4">
        <div class="text-lg font-semibold tracking-tight">{{ card.statusLabel }}</div>
        <div class="mt-1 font-mono text-xs text-muted-foreground">{{ card.durationText }}</div>

        <div class="mt-3 flex flex-wrap gap-2">
          <span
            class="rounded-md border px-2 py-1 font-mono text-[11px]"
            :class="
              card.warningCount > 0
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                : 'border-border/70 bg-muted/30 text-muted-foreground'
            "
          >
            W {{ card.warningCount }}
          </span>
          <span
            class="rounded-md border px-2 py-1 font-mono text-[11px]"
            :class="
              card.errorCount > 0
                ? 'border-destructive/30 bg-destructive/10 text-destructive'
                : 'border-border/70 bg-muted/30 text-muted-foreground'
            "
          >
            E {{ card.errorCount }}
          </span>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            class="h-8 rounded-md"
            :disabled="!card.canViewLog"
            @click="emit('viewLog', card.stage)"
          >
            {{ t('viewLog') }}
          </Button>
          <Button
            v-if="card.canViewTiming"
            type="button"
            size="sm"
            variant="outline"
            class="h-8 rounded-md"
            @click="emit('viewTiming', card.stage)"
          >
            {{ t('timingReport') }}
          </Button>
        </div>
      </div>
    </article>
  </div>
</template>
