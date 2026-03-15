<script setup lang="ts">
import type { SynthesisReportV1, SynthesisSourceFileV1 } from '@/lib/hardware-client'

import { computed, ref, watch } from 'vue'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'

const activeFileName = designContextStore.sourceName
const topModule = designContextStore.primaryModule

const isBusy = ref(false)
const synthesisMessage = ref('')
const synthesisReport = ref<SynthesisReportV1 | null>(null)

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
  if (synthesisReport.value) {
    return synthesisReport.value.log.trim() || 'Yosys finished without log output.'
  }

  if (synthesisMessage.value) {
    return synthesisMessage.value
  }

  return 'Run synthesis to invoke Yosys on the current project sources.'
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

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

async function runSynthesis() {
  if (!canRunSynthesis.value) {
    return
  }

  isBusy.value = true
  synthesisMessage.value = ''

  try {
    synthesisReport.value = await hardwareStore.runSynthesis({
      top_module: topModule.value,
      files: synthesisSources.value,
    })
  } catch (err) {
    synthesisReport.value = null
    synthesisMessage.value = getErrorMessage(err)
  } finally {
    isBusy.value = false
  }
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
    synthesisReport.value = null
    synthesisMessage.value = ''
  },
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
      v-if="synthesisMessage || (synthesisReport && !synthesisReport.success)"
      class="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      {{
        synthesisMessage ||
        `Yosys reported ${synthesisReport?.errors ?? 0} error(s). Review the log below.`
      }}
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
            <span v-if="synthesisReport">Tool: {{ synthesisReport.tool_path }}</span>
            <span v-if="synthesisReport">
              {{ synthesisReport.warnings }} warning{{ synthesisReport.warnings === 1 ? '' : 's' }}
            </span>
            <span v-if="synthesisReport">
              {{ synthesisReport.errors }} error{{ synthesisReport.errors === 1 ? '' : 's' }}
            </span>
          </div>
        </CardHeader>
        <CardContent class="flex-1 min-h-0 p-0">
          <ScrollArea class="h-full w-full p-4 font-mono text-xs bg-muted/40 text-foreground">
            <pre class="whitespace-pre-wrap">{{ synthesisLog }}</pre>
          </ScrollArea>
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
              No synthesized cells reported.
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
