<script setup lang="ts">
import type { SynthesisSourceFileV1 } from '@/lib/hardware-client'

import { computed, nextTick, ref, watch } from 'vue'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useI18n } from '@/lib/i18n'
import { resolveSynthesisLog } from '@/lib/synthesis-log'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'
import { projectStore } from '@/stores/project'

const activeFileName = designContextStore.sourceName
const topModule = designContextStore.primaryModule
const { t } = useI18n()

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
    return t('running')
  }

  if (synthesisReport.value) {
    return synthesisReport.value.success ? t('completed') : t('failed')
  }

  return synthesisSources.value.length > 0 ? t('ready') : t('noSource')
})

const synthesisErrorMessage = computed(() => {
  if (isBusy.value) {
    return ''
  }

  if (synthesisMessage.value.trim().length > 0) {
    return synthesisMessage.value
  }

  if (synthesisReport.value && !synthesisReport.value.success) {
    return t('yosysReportedErrors', { count: synthesisReport.value.errors })
  }

  return ''
})

const summaryCards = computed(() => {
  const stats = synthesisReport.value?.stats

  return [
    {
      title: t('cells'),
      value: stats?.cell_count ?? 0,
      hint: t('flattenedSynthesizedCells'),
    },
    {
      title: t('sequential'),
      value: stats?.sequential_cell_count ?? 0,
      hint: t('sequentialHint'),
    },
    {
      title: t('memories'),
      value: stats?.memory_count ?? 0,
      hint: t('totalMemoryBits', { count: stats?.memory_bits ?? 0 }),
    },
    {
      title: t('sources'),
      value: synthesisSources.value.length,
      hint: t('topModuleHint', { name: topModule.value }),
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

  return t('zeroCellExplanation', { name: topModule.value })
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
      project_name: projectStore.toSnapshot().name,
      project_dir: projectDirectory(),
      top_module: topModule.value,
      files: synthesisSources.value,
    })
  } catch {
    // The store publishes synthesisMessage for the page to render.
  }
}

function projectDirectory() {
  const projectPath = projectStore.projectPath
  if (!projectPath) {
    return null
  }

  const normalized = projectPath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  return lastSlash >= 0 ? normalized.slice(0, lastSlash) : null
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
        <h2 class="text-3xl font-bold tracking-tight">{{ t('synthesis') }}</h2>
        <p class="text-muted-foreground">
          {{
            t('synthesisDescription', {
              count: synthesisSources.length,
              suffix: synthesisSources.length === 1 ? '' : 's',
              top: topModule,
            })
          }}
        </p>
      </div>
      <div class="flex gap-2 items-center">
        <Badge variant="outline">{{ t('topModuleHint', { name: topModule }) }}</Badge>
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
          {{ isBusy ? t('runningEllipsis') : t('runSynthesis') }}
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
          <CardTitle>{{ t('synthesisLog') }}</CardTitle>
          <div class="flex items-center gap-2 text-xs text-muted-foreground">
            <span v-if="synthesisReport">
              {{ t('warningCount', { count: synthesisReport.warnings }) }}
            </span>
            <span v-if="synthesisReport">
              {{ t('errorCount', { count: synthesisReport.errors }) }}
            </span>
          </div>
        </CardHeader>
        <CardContent class="flex-1 min-h-0 p-0">
          <div
            ref="synthesisLogViewportRef"
            class="allow-text-select h-full w-full overflow-auto bg-muted/40 p-4 font-mono text-xs text-foreground"
          >
            <pre class="whitespace-pre-wrap">{{ synthesisLog }}</pre>
          </div>
        </CardContent>
      </Card>

      <Card class="min-h-0 flex flex-col">
        <CardHeader>
          <CardTitle>{{ t('cellBreakdown') }}</CardTitle>
        </CardHeader>
        <CardContent class="flex-1 min-h-0 p-0">
          <ScrollArea class="h-full w-full px-4 pb-4">
            <div v-if="!synthesisReport" class="py-4 text-sm text-muted-foreground">
              {{ t('runSynthesisToInspect') }}
            </div>
            <div
              v-else-if="synthesisReport.stats.cell_type_counts.length === 0"
              class="py-4 text-sm text-muted-foreground"
            >
              {{ zeroCellExplanation || t('noSynthesizedCells') }}
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
