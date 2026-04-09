<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import type {
  ImplementationReportV1,
  ImplementationStageKindV1,
  ImplementationStageResultV1,
} from '@/lib/hardware-client'

import { computed, ref } from 'vue'

import TextReportDialog from '@/components/flow/TextReportDialog.vue'
import { useI18n } from '@/lib/i18n'

import ImplementationSummaryCards from './ImplementationSummaryCards.vue'

const props = defineProps<{
  report: ImplementationReportV1 | null
  liveLog: string
}>()

const { t } = useI18n()

const reportDialogOpen = ref(false)
const reportDialogTitle = ref('')
const reportDialogDescription = ref('')
const reportDialogContent = ref('')
const reportDialogEmptyText = ref('')

const visibleStageOrder = [
  'map',
  'pack',
  'place',
  'route',
  'sta',
  'bitgen',
] as const satisfies readonly ImplementationStageKindV1[]

type VisibleImplementationStage = (typeof visibleStageOrder)[number]

type LiveStageProgress = {
  started: boolean
  running: boolean
  completed: boolean
  success: boolean | null
  elapsedMs: number | null
  warningCount: number
  errorCount: number
  liveLog: string
}

const optionalImplementationStages = new Set<ImplementationStageKindV1>(['sta'])

function stageTitle(stage: VisibleImplementationStage) {
  const keys = {
    map: 'implementationStageMap',
    pack: 'implementationStagePack',
    place: 'implementationStagePlace',
    route: 'implementationStageRoute',
    sta: 'implementationStageSta',
    bitgen: 'implementationStageBitgen',
  } as const

  return t(keys[stage])
}

function emptyLiveStageProgress(): LiveStageProgress {
  return {
    started: false,
    running: false,
    completed: false,
    success: null,
    elapsedMs: null,
    warningCount: 0,
    errorCount: 0,
    liveLog: '',
  }
}

function parseImplementationLiveStages(log: string) {
  const stages = new Map<ImplementationStageKindV1, LiveStageProgress>()
  const warningSectionByStage = new Map<ImplementationStageKindV1, boolean>()

  const ensureStage = (stage: ImplementationStageKindV1) => {
    const existing = stages.get(stage)
    if (existing) {
      return existing
    }

    const created = emptyLiveStageProgress()
    stages.set(stage, created)
    return created
  }

  for (const rawLine of log.split(/\r?\n/)) {
    const match = rawLine.match(/^\[(map|pack|place|route|sta|bitgen)\]\s?(.*)$/)
    if (!match) {
      continue
    }

    const stage = match[1] as ImplementationStageKindV1
    const line = match[2] ?? ''
    const trimmed = line.trimStart()
    const progress = ensureStage(stage)

    progress.liveLog = progress.liveLog.length > 0 ? `${progress.liveLog}\n${line}` : line

    if (trimmed.startsWith('>>> starting ')) {
      progress.started = true
      progress.running = true
      progress.completed = false
      progress.success = null
      warningSectionByStage.set(stage, false)
      continue
    }

    if (trimmed === 'warnings:') {
      warningSectionByStage.set(stage, true)
      continue
    }

    if (
      trimmed === 'messages:' ||
      trimmed === 'metrics:' ||
      trimmed === 'artifacts:' ||
      trimmed.startsWith('stage: ') ||
      trimmed.startsWith('status: ') ||
      trimmed.startsWith('elapsed_ms: ')
    ) {
      warningSectionByStage.set(stage, false)
    }

    if (warningSectionByStage.get(stage) && trimmed.startsWith('- ')) {
      progress.warningCount += 1
      continue
    }

    const elapsedMatch = trimmed.match(/^elapsed_ms:\s*(\d+)/)
    if (elapsedMatch) {
      progress.elapsedMs = Number(elapsedMatch[1])
      continue
    }

    if (trimmed === 'status: success' || trimmed === 'status: skipped') {
      progress.running = false
      progress.completed = true
      progress.success = true
      continue
    }

    if (trimmed === 'status: failed' || /^stage\s+\w+\s+failed$/.test(trimmed)) {
      progress.running = false
      progress.completed = true
      progress.success = false
      warningSectionByStage.set(stage, false)
      continue
    }

    if (/^error:/i.test(trimmed)) {
      progress.errorCount += 1
      progress.running = false
      progress.completed = true
      progress.success = false
      warningSectionByStage.set(stage, false)
    }
  }

  return stages
}

function formatDuration(elapsedMs: number) {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return '0 ms'
  }

  if (elapsedMs < 1000) {
    return `${Math.round(elapsedMs)} ms`
  }

  return `${(elapsedMs / 1000).toFixed(2).replace(/\.?0+$/, '')} s`
}

const liveStageProgress = computed(() => {
  return parseImplementationLiveStages(props.liveLog)
})

function stageResultFor(stage: ImplementationStageKindV1): ImplementationStageResultV1 | null {
  return props.report?.stages.find((entry) => entry.stage === stage) ?? null
}

function stageWarningCount(
  stage: ImplementationStageKindV1,
  result: ImplementationStageResultV1 | null,
) {
  return result?.warning_count ?? liveStageProgress.value.get(stage)?.warningCount ?? 0
}

function stageErrorCount(
  stage: ImplementationStageKindV1,
  result: ImplementationStageResultV1 | null,
) {
  return result?.error_count ?? liveStageProgress.value.get(stage)?.errorCount ?? 0
}

const stageCards = computed(() => {
  return visibleStageOrder.map((stage) => {
    const result = stageResultFor(stage)
    const live = liveStageProgress.value.get(stage) ?? null
    return {
      stage,
      title: stageTitle(stage),
      result,
      live,
      warningCount: stageWarningCount(stage, result),
      errorCount: stageErrorCount(stage, result),
    }
  })
})

function stageStatusLabel(stage: (typeof stageCards.value)[number]) {
  if (stage.live?.running) {
    return t('running')
  }

  if (!stage.result) {
    if (stage.live?.completed) {
      if (stage.live.success) {
        return t('completed')
      }

      return optionalImplementationStages.has(stage.stage) ? t('warnings') : t('failed')
    }

    return t('pending')
  }

  if (stage.result.success) {
    return t('completed')
  }

  return stage.result.optional ? t('warnings') : t('failed')
}

function stageStatusDotClass(stage: (typeof stageCards.value)[number]) {
  if (stage.live?.running) {
    return 'bg-blue-500 animate-pulse'
  }

  if (!stage.result) {
    if (stage.live?.completed) {
      if (stage.live.success) {
        return stage.warningCount > 0 ? 'bg-amber-500' : 'bg-emerald-500'
      }

      return optionalImplementationStages.has(stage.stage) ? 'bg-amber-500' : 'bg-destructive'
    }

    return 'bg-muted-foreground/35'
  }

  if (stage.errorCount > 0 && !stage.result.success && !stage.result.optional) {
    return 'bg-destructive'
  }

  if (stage.warningCount > 0 || stage.result.optional) {
    return 'bg-amber-500'
  }

  if (stage.result.success) {
    return 'bg-emerald-500'
  }

  if (stage.result.optional) {
    return 'bg-amber-500'
  }

  return 'bg-destructive'
}

function stageDurationText(stage: (typeof stageCards.value)[number]) {
  if (stage.result) {
    return formatDuration(stage.result.elapsed_ms)
  }

  if (typeof stage.live?.elapsedMs === 'number') {
    return formatDuration(stage.live.elapsedMs)
  }

  if (stage.live?.running) {
    return `${t('running')}...`
  }

  return t('notRunYet')
}

const summaryStageCardRows = computed(() => {
  return stageCards.value.map((stage) => ({
    stage: stage.stage,
    title: stage.title,
    statusLabel: stageStatusLabel(stage),
    statusDotClass: stageStatusDotClass(stage),
    durationText: stageDurationText(stage),
    warningCount: stage.warningCount,
    errorCount: stage.errorCount,
    canViewLog: Boolean(stage.result?.log_path) || (stage.live?.liveLog.trim().length ?? 0) > 0,
    canViewTiming: stage.stage === 'sta' && Boolean(props.report?.timing_report.trim().length),
  }))
})

async function openStageLog(stageKind: string) {
  const stage = stageCards.value.find((entry) => entry.stage === stageKind)
  if (!stage) {
    return
  }

  reportDialogTitle.value = `${stage.title} · ${t('viewLog')}`
  reportDialogDescription.value = `${stageStatusLabel(stage)} · ${stageDurationText(stage)}`
  reportDialogEmptyText.value = t('noLogAvailable')

  if (stage.live?.liveLog.trim().length && !stage.result?.log_path) {
    reportDialogContent.value = stage.live.liveLog
    reportDialogOpen.value = true
    return
  }

  if (!stage.result?.log_path) {
    reportDialogContent.value = ''
    reportDialogOpen.value = true
    return
  }

  try {
    reportDialogContent.value = await invoke<string>('read_project_file', {
      path: stage.result.log_path,
    })
  } catch (error) {
    reportDialogContent.value = String(error instanceof Error ? error.message : (error ?? ''))
  }

  reportDialogOpen.value = true
}

function openTimingReport() {
  reportDialogTitle.value = t('timingReport')
  reportDialogDescription.value = props.report?.timing_success ? t('completed') : t('warnings')
  reportDialogContent.value = props.report?.timing_report ?? ''
  reportDialogEmptyText.value = t('noTimingReportAvailable')
  reportDialogOpen.value = true
}
</script>

<template>
  <TextReportDialog
    :open="reportDialogOpen"
    :title="reportDialogTitle"
    :description="reportDialogDescription"
    :content="reportDialogContent"
    :empty-text="reportDialogEmptyText"
    @update:open="reportDialogOpen = $event"
  />

  <ImplementationSummaryCards
    :cards="summaryStageCardRows"
    @view-log="openStageLog"
    @view-timing="openTimingReport"
  />
</template>
