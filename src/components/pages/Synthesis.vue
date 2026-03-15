<script setup lang="ts">
import type { SynthesisSourceFileV1 } from '@/lib/hardware-client'

import { computed, nextTick, ref, watch } from 'vue'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { resolveSynthesisLog } from '@/lib/synthesis-log'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'

const activeFileName = designContextStore.sourceName
const topModule = designContextStore.primaryModule

const isBusy = hardwareStore.synthesisRunning
const synthesisMessage = hardwareStore.synthesisMessage
const synthesisReport = hardwareStore.synthesisReport
const synthesisLiveLog = hardwareStore.synthesisLiveLog
const synthesisLogViewportRef = ref<HTMLDivElement | null>(null)

const synthesisSources = computed<SynthesisSourceFileV1[]>(() => {
  return designContextStore.hardwareSources.value.map((source) => ({
    path: source.path,
    content: source.code,
  }))
})

const canRunSynthesis = computed(() => {
  return !isBusy.value && synthesisSources.value.length > 0 && topModule.value.trim().length > 0
})

const synthesisStatus = computed(() => {
  if (isBusy.value) {
    return 'Running'
  }

  if (synthesisReport.value) {
    return synthesisReport.value.success ? 'Completed' : 'Failed'
  }

  return synthesisSources.value.length > 0 ? 'Ready' : 'No Source'
})

const synthesisErrorMessage = computed(() => {
  if (isBusy.value) {
    return ''
  }

  if (synthesisMessage.value.trim().length > 0) {
    return synthesisMessage.value
  }

  if (synthesisReport.value && !synthesisReport.value.success) {
    return `Yosys reported ${synthesisReport.value.errors} error(s). Review the log below.`
  }

  return ''
})

const summaryCards = computed(() => {
  const stats = synthesisReport.value?.stats

  return [
    {
      title: 'Cells',
      value: stats?.cell_count ?? 0,
      hint: 'Flattened synthesized cells',
    },
    {
      title: 'Sequential',
      value: stats?.sequential_cell_count ?? 0,
      hint: 'Flip-flops and latches',
    },
    {
      title: 'Memories',
      value: stats?.memory_count ?? 0,
      hint: `${stats?.memory_bits ?? 0} total memory bits`,
    },
    {
      title: 'Sources',
      value: synthesisSources.value.length,
      hint: `Top module: ${topModule.value}`,
    },
  ]
})

const synthesisLog = computed(() => {
  return resolveSynthesisLog(
    synthesisReport.value?.log ?? null,
    synthesisLiveLog.value,
    synthesisMessage.value,
  )
})

const zeroCellExplanation = computed(() => {
  if (!synthesisReport.value?.success) {
    return ''
  }

  if ((synthesisReport.value.stats.cell_count ?? 0) > 0) {
    return ''
  }

  return `Top module ${topModule.value} synthesized to only ports and direct wiring. Modules that are not instantiated by the top module are removed from the result.`
})

function formatDuration(elapsedMs: number) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return '0 ms'
  }

  if (elapsedMs < 1000) {
    return `${Math.round(elapsedMs)} ms`
  }

  return `${(elapsedMs / 1000).toFixed(2).replace(/\.?0+$/, '')} s`
}

async function runSynthesis() {
  if (!canRunSynthesis.value) {
    return
  }

  const opId = crypto.randomUUID()

  try {
    await hardwareStore.runSynthesis({
      op_id: opId,
      top_module: topModule.value,
      files: synthesisSources.value,
    })
  } catch {
    // The store publishes synthesisMessage for the page to render.
  }
}

async function scrollSynthesisLogToBottom() {
  await nextTick()
  const viewport = synthesisLogViewportRef.value
  if (!viewport) {
    return
  }
  viewport.scrollTop = viewport.scrollHeight
}

watch(
  [
    topModule,
    () =>
      synthesisSources.value
        .map((source) => `${source.path}\u0000${source.content}`)
        .join('\u0001'),
  ],
  () => {
    hardwareStore.resetSynthesisState()
  },
)

watch(
  () => synthesisLog.value,
  () => {
    void scrollSynthesisLogToBottom()
  },
  { flush: 'post', immediate: true },
)
</script>

<template>
  <div class="p-8 space-y-8 h-full flex flex-col animate-in fade-in duration-500">
    <div class="flex items-center justify-between shrink-0 gap-4">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">Synthesis</h2>
        <p class="text-muted-foreground">
          Run Yosys on {{ synthesisSources.length }} project source{{
            synthesisSources.length === 1 ? '' : 's'
          }}
          with top module {{ topModule }}.
        </p>
      </div>
      <div class="flex gap-2 items-center">
        <Badge
          variant="outline"
          :class="
            synthesisStatus === 'Completed'
              ? 'bg-green-500/10 text-green-500 border-green-500/20'
              : synthesisStatus === 'Failed'
                ? 'bg-red-500/10 text-red-500 border-red-500/20'
                : ''
          "
        >
          {{ synthesisStatus }}
        </Badge>
        <span class="text-sm text-muted-foreground">
          {{ synthesisReport ? formatDuration(synthesisReport.elapsed_ms) : activeFileName }}
        </span>
        <Button type="button" size="sm" :disabled="!canRunSynthesis" @click="runSynthesis">
          {{ isBusy ? 'Running...' : 'Run Synthesis' }}
        </Button>
      </div>
    </div>

    <div
      v-if="synthesisErrorMessage"
      class="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      {{ synthesisErrorMessage }}
    </div>

    <div
      v-else-if="zeroCellExplanation"
      class="rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
    >
      {{ zeroCellExplanation }}
    </div>

    <div class="grid gap-4 md:grid-cols-4 shrink-0">
      <Card v-for="card in summaryCards" :key="card.title">
        <CardHeader class="pb-2">
          <CardTitle class="text-sm font-medium">{{ card.title }}</CardTitle>
        </CardHeader>
        <CardContent>
          <div class="text-2xl font-bold">{{ card.value }}</div>
          <p class="text-xs text-muted-foreground">{{ card.hint }}</p>
        </CardContent>
      </Card>
    </div>

    <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px] flex-1 min-h-0">
      <Card class="min-h-0 flex flex-col">
        <CardHeader class="flex-row items-center justify-between space-y-0">
          <CardTitle>Synthesis Log</CardTitle>
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <span v-if="synthesisReport">
              {{ synthesisReport.warnings }} warning{{ synthesisReport.warnings === 1 ? '' : 's' }}
            </span>
            <span v-if="synthesisReport">
              {{ synthesisReport.errors }} error{{ synthesisReport.errors === 1 ? '' : 's' }}
            </span>
          </div>
        </CardHeader>
        <CardContent class="flex-1 min-h-0 p-0">
          <div
            ref="synthesisLogViewportRef"
            class="h-full w-full overflow-auto bg-muted/40 p-4 font-mono text-xs text-foreground"
          >
            <pre class="whitespace-pre-wrap">{{ synthesisLog }}</pre>
          </div>
        </CardContent>
      </Card>

      <Card class="min-h-0 flex flex-col">
        <CardHeader>
          <CardTitle>Cell Breakdown</CardTitle>
        </CardHeader>
        <CardContent class="flex-1 min-h-0 p-0">
          <ScrollArea class="h-full w-full px-4 pb-4">
            <div v-if="!synthesisReport" class="py-4 text-sm text-muted-foreground">
              Run synthesis to inspect cell types.
            </div>
            <div
              v-else-if="synthesisReport.stats.cell_type_counts.length === 0"
              class="py-4 text-sm text-muted-foreground"
            >
              {{ zeroCellExplanation || 'No synthesized cells reported.' }}
            </div>
            <div v-else class="space-y-2">
              <div
                v-for="entry in synthesisReport.stats.cell_type_counts"
                :key="entry.cell_type"
                class="flex items-center justify-between rounded-lg border border-border/60 px-3 py-2 text-sm"
              >
                <span class="font-mono text-xs">{{ entry.cell_type }}</span>
                <span class="font-medium">{{ entry.count }}</span>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  </div>
</template>
