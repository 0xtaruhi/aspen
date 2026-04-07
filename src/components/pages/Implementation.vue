<script setup lang="ts">
import { invoke } from '@tauri-apps/api/core'
import type { ImplementationRequestV1 } from '@/lib/hardware-client'

import { ArrowRight, CheckCircle2, TriangleAlert } from 'lucide-vue-next'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import TextReportDialog from '@/components/flow/TextReportDialog.vue'
import ImplementationSummaryCards from '@/components/implementation/ImplementationSummaryCards.vue'
import NewProjectDialog from '@/components/project/NewProjectDialog.vue'
import RecentProjectsPanel from '@/components/project/RecentProjectsPanel.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useI18n } from '@/lib/i18n'
import { getProjectRootDirectory } from '@/lib/project-layout'
import { buildConstraintXml, resolveCurrentProjectPinConstraints } from '@/lib/project-constraints'
import { CURRENT_SYNTHESIS_ARTIFACT_FLOW_REVISION } from '@/lib/synthesis-artifact-flow'
import { importProjectFiles, openProject } from '@/lib/project-io'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'
import { projectStore } from '@/stores/project'
import { signalCatalogStore } from '@/stores/signal-catalog'

const router = useRouter()
const { t } = useI18n()

const showNewProjectDialog = ref(false)
const reportDialogOpen = ref(false)
const reportDialogTitle = ref('')
const reportDialogDescription = ref('')
const reportDialogContent = ref('')
const reportDialogEmptyText = ref('')

const isBusy = hardwareStore.implementationRunning
const implementationReport = hardwareStore.implementationReport
const implementationMessage = hardwareStore.implementationMessage
const projectName = computed(() => projectStore.toSnapshot().name)

const synthesisReport = signalCatalogStore.currentSynthesisReport
const hasCurrentSynthesis = computed(() => Boolean(synthesisReport.value))
const hasDesignSource = computed(() => Boolean(designContextStore.selectedSource.value))
const implementationProjectFiles = designContextStore.projectBuildFiles
const implementationHardwareFiles = designContextStore.hardwareBuildFiles

const reusableSynthesizedEdifPath = computed(() => {
  const artifacts = synthesisReport.value?.artifacts
  if (!artifacts?.edif_path) {
    return null
  }

  if (artifacts.flow_revision !== CURRENT_SYNTHESIS_ARTIFACT_FLOW_REVISION) {
    return null
  }

  return artifacts.edif_path
})

const hasReusableSynthesisArtifact = computed(() => Boolean(reusableSynthesizedEdifPath.value))

const currentConstraintAssignments = computed(() => {
  return resolveCurrentProjectPinConstraints(
    projectStore.pinConstraints,
    projectStore.topFileId,
    signalCatalogStore.signals.value,
  )
})

const fullyMapped = computed(() => {
  const topSignals = signalCatalogStore.signals.value
  if (topSignals.length === 0) {
    return true
  }

  return currentConstraintAssignments.value.length === topSignals.length
})

const implementationConstraintXml = computed(() => {
  return buildConstraintXml(
    designContextStore.primaryModule.value,
    currentConstraintAssignments.value,
  )
})

const canRunImplementation = computed(() => {
  return (
    !isBusy.value &&
    hasCurrentSynthesis.value &&
    hasReusableSynthesisArtifact.value &&
    fullyMapped.value &&
    implementationHardwareFiles.value.length > 0 &&
    designContextStore.primaryModule.value.trim().length > 0
  )
})

const implementationStatus = computed(() => {
  if (isBusy.value) {
    return t('running')
  }

  if (implementationReport.value) {
    return implementationReport.value.success ? t('completed') : t('failed')
  }

  return canRunImplementation.value ? t('ready') : t('noSource')
})

const implementationErrorMessage = computed(() => {
  if (isBusy.value) {
    return ''
  }

  if (implementationMessage.value.trim().length > 0) {
    return implementationMessage.value
  }

  if (implementationReport.value && !implementationReport.value.success) {
    return t('implementationFailedReviewStages')
  }

  return ''
})

const visibleStageOrder = ['map', 'pack', 'place', 'route', 'sta', 'bitgen'] as const

const stageCards = computed(() => {
  const stageMap = new Map(
    (implementationReport.value?.stages ?? []).map((stage) => [stage.stage, stage]),
  )

  return visibleStageOrder.map((stage) => {
    const result = stageMap.get(stage) ?? null
    return {
      stage,
      title: t(
        (
          {
            map: 'implementationStageMap',
            pack: 'implementationStagePack',
            place: 'implementationStagePlace',
            route: 'implementationStageRoute',
            sta: 'implementationStageSta',
            bitgen: 'implementationStageBitgen',
          } as const
        )[stage],
      ),
      result,
    }
  })
})

const readinessChecklist = computed(() => [
  {
    key: 'sources',
    label: t('sourceFiles'),
    ready: projectStore.hasProject && hasDesignSource.value,
  },
  {
    key: 'synthesis',
    label: t('implementationRequiresSynthesis'),
    ready: hasCurrentSynthesis.value && hasReusableSynthesisArtifact.value,
  },
  {
    key: 'pins',
    label: t('pinPlanning'),
    ready: fullyMapped.value,
  },
])

const blockingState = computed(() => {
  if (!projectStore.hasProject) {
    return {
      title: t('noProjectLoaded'),
      description: t('noProjectLoadedDescription'),
      actions: [
        {
          label: t('createProject'),
          onClick: () => (showNewProjectDialog.value = true),
          variant: 'default' as const,
        },
        { label: t('openProject'), onClick: openProject, variant: 'outline' as const },
      ],
      showRecentProjects: true,
    }
  }

  if (!hasDesignSource.value) {
    return {
      title: t('noDesignSourceLoaded'),
      description: t('noDesignSourceLoadedDescription'),
      actions: [
        { label: t('importFiles'), onClick: importProjectFiles, variant: 'outline' as const },
      ],
      showRecentProjects: false,
    }
  }

  if (!hasCurrentSynthesis.value || !hasReusableSynthesisArtifact.value) {
    return {
      title: t('implementationRequiresSynthesis'),
      description: hasCurrentSynthesis.value
        ? t('implementationRequiresFreshSynthesisDescription')
        : t('implementationRequiresSynthesisDescription'),
      actions: [{ label: t('runSynthesis'), onClick: goToSynthesis, variant: 'default' as const }],
      showRecentProjects: false,
    }
  }

  if (!fullyMapped.value) {
    return {
      title: t('implementationRequiresPinPlanning'),
      description: t('implementationRequiresPinPlanningDescription'),
      actions: [{ label: t('pinPlanning'), onClick: openPinPlanning, variant: 'default' as const }],
      showRecentProjects: false,
    }
  }

  return null
})

function projectDirectory() {
  return getProjectRootDirectory(projectStore.projectPath)
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

const implementationStatusBadgeClass = computed(() => {
  if (isBusy.value) {
    return 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300'
  }

  if (implementationReport.value?.success) {
    return 'border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  }

  if (implementationReport.value && !implementationReport.value.success) {
    return 'border-destructive/20 bg-destructive/10 text-destructive'
  }

  return 'border-border/70 bg-muted/40 text-foreground'
})

const implementationHeaderMeta = computed(() => {
  return implementationReport.value
    ? formatDuration(implementationReport.value.elapsed_ms)
    : designContextStore.sourceName.value || t('implementationFlowIdle')
})

const summaryStageCardRows = computed(() => {
  return stageCards.value.map((stage) => ({
    stage: stage.stage,
    title: stage.title,
    statusLabel: stageStatusLabel(stage),
    statusDotClass: stageStatusDotClass(stage),
    durationText: stage.result ? formatDuration(stage.result.elapsed_ms) : t('notRunYet'),
    canViewLog: Boolean(stage.result?.log_path),
    canViewTiming:
      stage.stage === 'sta' && Boolean(implementationReport.value?.timing_report.trim().length),
  }))
})

function stageStatusLabel(stage: (typeof stageCards.value)[number]) {
  if (!stage.result) {
    return t('pending')
  }

  if (stage.result.success) {
    return t('completed')
  }

  return stage.result.optional ? t('warnings') : t('failed')
}

function stageStatusDotClass(stage: (typeof stageCards.value)[number]) {
  if (!stage.result) {
    return 'bg-muted-foreground/35'
  }

  if (stage.result.success) {
    return 'bg-emerald-500'
  }

  if (stage.result.optional) {
    return 'bg-amber-500'
  }

  return 'bg-destructive'
}

async function runImplementation() {
  if (!canRunImplementation.value) {
    return
  }

  const request: ImplementationRequestV1 = {
    op_id: crypto.randomUUID(),
    project_name: projectName.value || 'project',
    project_dir: projectDirectory(),
    top_module: designContextStore.primaryModule.value,
    target_device_id: projectStore.targetDeviceId,
    constraint_xml: implementationConstraintXml.value,
    place_mode: projectStore.implementationSettings.placeMode,
    synthesized_edif_path: reusableSynthesizedEdifPath.value,
    files: implementationProjectFiles.value,
  }

  try {
    await hardwareStore.runImplementation(request)
  } catch {
    // The store publishes implementationMessage for rendering.
  }
}

function openPinPlanning() {
  void router.push({ name: 'fpga-flow-pin-planning' })
}

function goToSynthesis() {
  void router.push({ name: 'fpga-flow-synthesis' })
}

async function openStageLog(stageKind: string) {
  const stage = stageCards.value.find((entry) => entry.stage === stageKind)
  if (!stage) {
    return
  }

  reportDialogTitle.value = `${stage.title} · ${t('viewLog')}`
  reportDialogDescription.value = stage.result
    ? `${stageStatusLabel(stage)} · ${formatDuration(stage.result.elapsed_ms)}`
    : t('notRunYet')
  reportDialogEmptyText.value = t('noLogAvailable')

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
  reportDialogDescription.value = implementationReport.value?.timing_success
    ? t('completed')
    : t('warnings')
  reportDialogContent.value = implementationReport.value?.timing_report ?? ''
  reportDialogEmptyText.value = t('noTimingReportAvailable')
  reportDialogOpen.value = true
}

watch(
  [
    () => designContextStore.primaryModule.value,
    () =>
      implementationProjectFiles.value
        .map((source) => `${source.path}\u0000${source.content}`)
        .join('\u0001'),
    () => implementationConstraintXml.value,
    () => projectStore.targetDeviceId,
    () => projectStore.implementationSettings.placeMode,
  ],
  () => {
    hardwareStore.resetImplementationState()
  },
)
</script>

<template>
  <NewProjectDialog v-model:open="showNewProjectDialog" />
  <TextReportDialog
    :open="reportDialogOpen"
    :title="reportDialogTitle"
    :description="reportDialogDescription"
    :content="reportDialogContent"
    :empty-text="reportDialogEmptyText"
    @update:open="reportDialogOpen = $event"
  />

  <div class="p-8 space-y-6 h-full flex flex-col animate-in fade-in duration-500">
    <div class="flex items-center justify-between shrink-0 gap-4">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">{{ t('implementation') }}</h2>
        <p class="text-muted-foreground">
          {{ t('implementationDescription', { name: designContextStore.sourceName.value }) }}
        </p>
      </div>
      <div class="flex gap-2 items-center flex-wrap justify-end">
        <Badge variant="outline" :class="implementationStatusBadgeClass">
          {{ implementationStatus }}
        </Badge>
        <span class="text-sm text-muted-foreground">
          {{ implementationHeaderMeta }}
        </span>
        <Button
          type="button"
          size="sm"
          :disabled="!canRunImplementation"
          @click="runImplementation"
        >
          {{ isBusy ? t('runningEllipsis') : t('runImplementation') }}
          <ArrowRight class="ml-2 h-4 w-4" />
        </Button>
      </div>
    </div>

    <div
      v-if="implementationErrorMessage"
      class="rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      {{ implementationErrorMessage }}
    </div>

    <div v-if="blockingState" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card>
        <CardHeader>
          <CardTitle>{{ blockingState.title }}</CardTitle>
        </CardHeader>
        <CardContent class="space-y-4">
          <div class="flex items-start gap-3 text-sm text-muted-foreground">
            <TriangleAlert class="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <p>{{ blockingState.description }}</p>
          </div>

          <div class="flex flex-wrap gap-3">
            <Button
              v-for="action in blockingState.actions"
              :key="action.label"
              type="button"
              :variant="action.variant"
              @click="action.onClick()"
            >
              {{ action.label }}
            </Button>
          </div>

          <div v-if="blockingState.showRecentProjects" class="border-t border-border pt-4">
            <RecentProjectsPanel />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{{ t('implementation') }}</CardTitle>
        </CardHeader>
        <CardContent class="space-y-2">
          <div
            v-for="item in readinessChecklist"
            :key="item.key"
            class="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-3"
          >
            <div class="flex items-center gap-3">
              <CheckCircle2 v-if="item.ready" class="h-4 w-4 text-emerald-600" />
              <TriangleAlert v-else class="h-4 w-4 text-amber-600" />
              <div>
                <div class="text-sm font-medium">{{ item.label }}</div>
                <div class="text-xs text-muted-foreground">
                  {{ item.ready ? t('completed') : t('pending') }}
                </div>
              </div>
            </div>
            <Badge
              variant="outline"
              :class="
                item.ready
                  ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-600'
                  : 'border-amber-500/20 bg-amber-500/10 text-amber-600'
              "
            >
              {{ item.ready ? t('ready') : t('pending') }}
            </Badge>
          </div>
        </CardContent>
      </Card>
    </div>

    <ImplementationSummaryCards
      v-else
      :cards="summaryStageCardRows"
      @view-log="openStageLog"
      @view-timing="openTimingReport"
    />
  </div>
</template>
