<script setup lang="ts">
import type { ImplementationRequestV1, SynthesisSourceFileV1 } from '@/lib/hardware-client'
import type {
  ImplementationPlaceMode,
  ImplementationRouteMode,
} from '@/lib/implementation-settings'

import { Check, Copy, SlidersHorizontal } from 'lucide-vue-next'
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import RightDrawer from '@/components/RightDrawer.vue'
import NewProjectDialog from '@/components/project/NewProjectDialog.vue'
import RecentProjectsPanel from '@/components/project/RecentProjectsPanel.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { copyTextToClipboard } from '@/lib/clipboard'
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
const showSettingsDrawer = ref(false)
const implementationLogViewportRef = ref<HTMLDivElement | null>(null)
const implementationLogCopied = ref(false)
let implementationLogCopiedTimer: ReturnType<typeof setTimeout> | null = null

const isBusy = hardwareStore.implementationRunning
const implementationReport = hardwareStore.implementationReport
const implementationMessage = hardwareStore.implementationMessage
const implementationLiveLog = hardwareStore.implementationLiveLog
const projectName = computed(() => projectStore.toSnapshot().name)

const synthesisReport = signalCatalogStore.currentSynthesisReport
const hasCurrentSynthesis = computed(() => Boolean(synthesisReport.value))
const hasDesignSource = computed(() => Boolean(designContextStore.selectedSource.value))

const implementationSources = computed<SynthesisSourceFileV1[]>(() => {
  return designContextStore.hardwareSources.value.map((source) => ({
    path: source.path,
    content: source.code,
  }))
})

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
    implementationSources.value.length > 0 &&
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

const implementationLog = computed(() => {
  const live = implementationLiveLog.value.trim()
  if (isBusy.value && live.length > 0) {
    return live
  }

  if (implementationReport.value?.log.trim()) {
    return implementationReport.value.log
  }

  if (live.length > 0) {
    return live
  }

  return implementationMessage.value
})

const placeModeOptions = computed<
  Array<{
    value: ImplementationPlaceMode
    label: string
    description: string
    tone: string
  }>
>(() => [
  {
    value: 'timing_driven',
    label: t('implementationPlaceModeTimingDriven'),
    description: t('implementationPlaceModeTimingDrivenDescription'),
    tone: t('implementationModeBalanced'),
  },
  {
    value: 'bounding_box',
    label: t('implementationPlaceModeBoundingBox'),
    description: t('implementationPlaceModeBoundingBoxDescription'),
    tone: t('implementationModeFast'),
  },
])

const routeModeOptions = computed<
  Array<{
    value: ImplementationRouteMode
    label: string
    description: string
    tone: string
  }>
>(() => [
  {
    value: 'timing_driven',
    label: t('implementationRouteModeTimingDriven'),
    description: t('implementationRouteModeTimingDrivenDescription'),
    tone: t('implementationModeBalanced'),
  },
  {
    value: 'direct_search',
    label: t('implementationRouteModeDirectSearch'),
    description: t('implementationRouteModeDirectSearchDescription'),
    tone: t('implementationModeFast'),
  },
  {
    value: 'breadth_first',
    label: t('implementationRouteModeBreadthFirst'),
    description: t('implementationRouteModeBreadthFirstDescription'),
    tone: t('implementationModeFastest'),
  },
])

const artifactRows = computed(() => {
  const artifacts = implementationReport.value?.artifacts
  if (!artifacts) {
    return []
  }

  return [
    { label: t('constraintXml'), value: artifacts.constraint_path },
    { label: t('synthesizedEdif'), value: artifacts.edif_path },
    { label: t('mappedNetlist'), value: artifacts.map_path },
    { label: t('packedNetlist'), value: artifacts.pack_path },
    { label: t('placedNetlist'), value: artifacts.place_path },
    { label: t('routedNetlist'), value: artifacts.route_path },
    { label: t('staReportFile'), value: artifacts.sta_report_path },
    { label: t('bitstreamFile'), value: artifacts.bitstream_path },
  ].filter((entry) => Boolean(entry.value))
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

function stageBadgeClass(stage: { result: (typeof stageCards.value)[number]['result'] }) {
  if (!stage.result) {
    return 'border-border/60 text-muted-foreground'
  }
  if (stage.result.success) {
    return 'border-green-500/20 bg-green-500/10 text-green-600'
  }
  if (stage.result.optional) {
    return 'border-amber-500/20 bg-amber-500/10 text-amber-600'
  }
  return 'border-destructive/20 bg-destructive/10 text-destructive'
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

const summaryStageCards = computed(() => {
  const summaryOrder = ['map', 'place', 'route', 'bitgen'] as const
  const stageMap = new Map(stageCards.value.map((stage) => [stage.stage, stage]))
  return summaryOrder
    .map((stage) => stageMap.get(stage))
    .filter((stage): stage is (typeof stageCards.value)[number] => Boolean(stage))
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
    route_mode: projectStore.implementationSettings.routeMode,
    synthesized_edif_path: reusableSynthesizedEdifPath.value,
    files: implementationSources.value,
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

function setPlaceMode(mode: ImplementationPlaceMode) {
  projectStore.setImplementationPlaceMode(mode)
}

function setRouteMode(mode: ImplementationRouteMode) {
  projectStore.setImplementationRouteMode(mode)
}

async function scrollImplementationLogToBottom() {
  await nextTick()
  const viewport = implementationLogViewportRef.value
  if (!viewport) {
    return
  }
  viewport.scrollTop = viewport.scrollHeight
}

async function copyImplementationLog() {
  if (implementationLog.value.trim().length === 0) {
    return
  }

  try {
    await copyTextToClipboard(implementationLog.value)
    implementationLogCopied.value = true
    if (implementationLogCopiedTimer) {
      clearTimeout(implementationLogCopiedTimer)
    }
    implementationLogCopiedTimer = setTimeout(() => {
      implementationLogCopied.value = false
      implementationLogCopiedTimer = null
    }, 1500)
  } catch {
    // Clipboard failures should not interrupt the flow page.
  }
}

watch(
  [
    () => designContextStore.primaryModule.value,
    () =>
      implementationSources.value
        .map((source) => `${source.path}\u0000${source.content}`)
        .join('\u0001'),
    () => implementationConstraintXml.value,
    () => projectStore.targetDeviceId,
    () => projectStore.implementationSettings.placeMode,
    () => projectStore.implementationSettings.routeMode,
  ],
  () => {
    hardwareStore.resetImplementationState()
  },
)

watch(
  () => implementationLog.value,
  () => {
    void scrollImplementationLogToBottom()
  },
  { flush: 'post', immediate: true },
)
</script>

<template>
  <NewProjectDialog v-model:open="showNewProjectDialog" />
  <div class="p-8 space-y-8 h-full flex flex-col animate-in fade-in duration-500">
    <div class="flex items-center justify-between shrink-0 gap-4">
      <div class="space-y-2">
        <h2 class="text-3xl font-bold tracking-tight">{{ t('implementation') }}</h2>
        <p class="max-w-3xl text-sm text-muted-foreground">
          {{ t('implementationDescription', { name: designContextStore.sourceName.value }) }}
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <Badge variant="outline" :class="implementationStatusBadgeClass">
          {{ implementationStatus }}
        </Badge>
        <span class="text-sm text-muted-foreground">
          {{ implementationHeaderMeta }}
        </span>
        <RightDrawer
          v-model="showSettingsDrawer"
          :title="t('implementationFlowSettings')"
          :width="420"
        >
          <template #trigger>
            <Button type="button" size="sm" variant="outline" class="gap-2">
              <SlidersHorizontal class="h-4 w-4" />
              {{ t('flowSettings') }}
            </Button>
          </template>

          <div class="space-y-6">
            <section class="space-y-3">
              <div class="space-y-1">
                <div class="text-sm font-semibold">{{ t('implementationPlaceEngine') }}</div>
                <p class="text-xs leading-5 text-muted-foreground">
                  {{ t('implementationPlaceEngineDescription') }}
                </p>
              </div>
              <div class="space-y-2">
                <button
                  v-for="option in placeModeOptions"
                  :key="option.value"
                  type="button"
                  class="w-full rounded-2xl border px-4 py-3 text-left transition-colors"
                  :class="
                    projectStore.implementationSettings.placeMode === option.value
                      ? 'border-foreground/20 bg-foreground/[0.06]'
                      : 'border-border/70 bg-background hover:border-foreground/15 hover:bg-muted/40'
                  "
                  @click="setPlaceMode(option.value)"
                >
                  <div class="flex items-start justify-between gap-4">
                    <div class="space-y-1">
                      <div class="text-sm font-medium">{{ option.label }}</div>
                      <div class="text-xs leading-5 text-muted-foreground">
                        {{ option.description }}
                      </div>
                    </div>
                    <Badge variant="outline" class="shrink-0">
                      {{ option.tone }}
                    </Badge>
                  </div>
                </button>
              </div>
            </section>

            <section class="space-y-3">
              <div class="space-y-1">
                <div class="text-sm font-semibold">{{ t('implementationRouteEngine') }}</div>
                <p class="text-xs leading-5 text-muted-foreground">
                  {{ t('implementationRouteEngineDescription') }}
                </p>
              </div>
              <div class="space-y-2">
                <button
                  v-for="option in routeModeOptions"
                  :key="option.value"
                  type="button"
                  class="w-full rounded-2xl border px-4 py-3 text-left transition-colors"
                  :class="
                    projectStore.implementationSettings.routeMode === option.value
                      ? 'border-foreground/20 bg-foreground/[0.06]'
                      : 'border-border/70 bg-background hover:border-foreground/15 hover:bg-muted/40'
                  "
                  @click="setRouteMode(option.value)"
                >
                  <div class="flex items-start justify-between gap-4">
                    <div class="space-y-1">
                      <div class="text-sm font-medium">{{ option.label }}</div>
                      <div class="text-xs leading-5 text-muted-foreground">
                        {{ option.description }}
                      </div>
                    </div>
                    <Badge variant="outline" class="shrink-0">
                      {{ option.tone }}
                    </Badge>
                  </div>
                </button>
              </div>
            </section>
          </div>
        </RightDrawer>
        <Button
          type="button"
          size="sm"
          :disabled="!canRunImplementation"
          @click="runImplementation"
        >
          {{ isBusy ? t('runningEllipsis') : t('runImplementation') }}
        </Button>
      </div>
    </div>

    <Card v-if="!projectStore.hasProject || !hasDesignSource" class="max-w-3xl">
      <CardHeader>
        <CardTitle>
          {{ projectStore.hasProject ? t('noDesignSourceLoaded') : t('noProjectLoaded') }}
        </CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">
          {{
            projectStore.hasProject
              ? t('noDesignSourceLoadedDescription')
              : t('noProjectLoadedDescription')
          }}
        </p>
        <div class="flex flex-wrap gap-3">
          <template v-if="projectStore.hasProject">
            <Button type="button" variant="outline" @click="importProjectFiles">
              {{ t('importFiles') }}
            </Button>
          </template>
          <template v-else>
            <Button type="button" @click="showNewProjectDialog = true">
              {{ t('createProject') }}
            </Button>
            <Button type="button" variant="outline" @click="openProject">
              {{ t('openProject') }}
            </Button>
            <div class="w-full pt-1">
              <RecentProjectsPanel />
            </div>
          </template>
        </div>
      </CardContent>
    </Card>

    <Card v-else-if="!hasCurrentSynthesis || !hasReusableSynthesisArtifact" class="max-w-3xl">
      <CardHeader>
        <CardTitle>{{ t('implementationRequiresSynthesis') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">
          {{
            hasCurrentSynthesis
              ? t('implementationRequiresFreshSynthesisDescription')
              : t('implementationRequiresSynthesisDescription')
          }}
        </p>
        <div class="flex flex-wrap gap-3">
          <Button type="button" @click="goToSynthesis">
            {{ t('runSynthesis') }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <Card v-else-if="!fullyMapped" class="max-w-3xl">
      <CardHeader>
        <CardTitle>{{ t('implementationRequiresPinPlanning') }}</CardTitle>
      </CardHeader>
      <CardContent class="space-y-4">
        <p class="text-sm text-muted-foreground">
          {{ t('implementationRequiresPinPlanningDescription') }}
        </p>
        <div class="flex flex-wrap gap-3">
          <Button type="button" @click="openPinPlanning">
            {{ t('pinPlanning') }}
          </Button>
        </div>
      </CardContent>
    </Card>

    <template v-else>
      <div
        v-if="implementationErrorMessage"
        class="rounded-xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive"
      >
        {{ implementationErrorMessage }}
      </div>

      <div class="grid gap-4 md:grid-cols-4 shrink-0">
        <Card v-for="stage in summaryStageCards" :key="stage.stage">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between gap-3">
              <CardTitle class="text-sm font-medium">{{ stage.title }}</CardTitle>
              <span class="h-2 w-2 rounded-full" :class="stageStatusDotClass(stage)" />
            </div>
          </CardHeader>
          <CardContent>
            <div class="text-2xl font-bold">{{ stageStatusLabel(stage) }}</div>
            <p class="text-xs text-muted-foreground">
              {{ stage.result ? formatDuration(stage.result.elapsed_ms) : t('notRunYet') }}
            </p>
          </CardContent>
        </Card>
      </div>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] flex-1 min-h-0">
        <Card class="min-h-0 flex flex-col">
          <CardHeader class="flex-row items-center justify-between space-y-0">
            <CardTitle>{{ t('implementationLog') }}</CardTitle>
            <div class="flex items-center gap-2">
              <span class="text-xs text-muted-foreground">
                {{ designContextStore.sourceName.value }}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                :disabled="implementationLog.trim().length === 0"
                class="h-7 gap-1.5 px-2 text-xs"
                @click="copyImplementationLog"
              >
                <Check v-if="implementationLogCopied" class="h-3.5 w-3.5" />
                <Copy v-else class="h-3.5 w-3.5" />
                {{ implementationLogCopied ? t('copied') : t('copyLog') }}
              </Button>
            </div>
          </CardHeader>
          <CardContent class="flex-1 min-h-0 p-0">
            <div
              ref="implementationLogViewportRef"
              class="allow-text-select h-full w-full overflow-auto bg-muted/40 p-4 font-mono text-xs text-foreground"
            >
              <pre class="whitespace-pre-wrap">{{ implementationLog }}</pre>
            </div>
          </CardContent>
        </Card>

        <Card class="min-h-0 flex flex-col">
          <CardHeader>
            <CardTitle>{{ t('implementationArtifacts') }}</CardTitle>
          </CardHeader>
          <CardContent class="min-h-0 flex-1 space-y-6 overflow-auto">
            <div class="space-y-2">
              <div class="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {{ t('status') }}
              </div>
              <div class="space-y-2">
                <div
                  v-for="stage in stageCards"
                  :key="stage.stage"
                  class="flex items-center justify-between gap-3 rounded-xl border border-border/60 px-3 py-2"
                >
                  <span class="text-sm">{{ stage.title }}</span>
                  <div class="flex items-center gap-3">
                    <span class="text-xs text-muted-foreground">
                      {{ stage.result ? formatDuration(stage.result.elapsed_ms) : t('notRunYet') }}
                    </span>
                    <Badge variant="outline" :class="stageBadgeClass(stage)">
                      {{
                        !stage.result
                          ? t('pending')
                          : stage.result.success
                            ? t('completed')
                            : stage.result.optional
                              ? t('warnings')
                              : t('failed')
                      }}
                    </Badge>
                  </div>
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <div class="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {{ t('implementationArtifacts') }}
              </div>
              <div v-if="artifactRows.length === 0" class="text-sm text-muted-foreground">
                {{ t('runImplementationToGenerateArtifacts') }}
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="artifact in artifactRows"
                  :key="artifact.label"
                  class="rounded-xl border border-border/60 px-3 py-2"
                >
                  <div class="text-xs text-muted-foreground">{{ artifact.label }}</div>
                  <div class="allow-text-select break-all font-mono text-xs">
                    {{ artifact.value }}
                  </div>
                </div>
              </div>
            </div>

            <div class="space-y-2">
              <div class="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {{ t('timingReport') }}
              </div>
              <div
                class="allow-text-select rounded-xl border border-border/60 bg-muted/30 p-3 font-mono text-xs"
              >
                <pre class="whitespace-pre-wrap">{{
                  implementationReport?.timing_report || t('noTimingReportAvailable')
                }}</pre>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </template>
  </div>
</template>
