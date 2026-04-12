<script setup lang="ts">
import type { ImplementationReportV1, ImplementationRequestV1 } from '@/lib/hardware-client'

import { ArrowRight } from 'lucide-vue-next'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import ImplementationBlockingState from '@/components/implementation/ImplementationBlockingState.vue'
import ImplementationStagesPanel from '@/components/implementation/ImplementationStagesPanel.vue'
import type {
  ImplementationBlockingStateViewModel,
  ImplementationReadinessChecklistItem,
} from '@/components/implementation/types'
import NewProjectDialog from '@/components/project/NewProjectDialog.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/lib/i18n'
import { getProjectRootDirectory } from '@/lib/project-layout'
import { importProjectFiles, openProject } from '@/lib/project-io'
import { statusBadgeClass } from '@/lib/status-badge'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'
import { implementationCatalogStore } from '@/stores/implementation-catalog'
import { projectStore } from '@/stores/project'
import { signalCatalogStore } from '@/stores/signal-catalog'
import { synthesisCatalogStore } from '@/stores/synthesis-catalog'

const router = useRouter()
const { t } = useI18n()

const showNewProjectDialog = ref(false)

const isBusy = hardwareStore.implementationRunning
const implementationLiveLog = hardwareStore.implementationLiveLog
const implementationMessage = hardwareStore.implementationMessage
const implementationReport = implementationCatalogStore.currentImplementationReport
const projectName = computed(() => projectStore.toSnapshot().name)

const hasCurrentSynthesis = synthesisCatalogStore.hasCurrentSuccessfulSynthesisReport
const hasDesignSource = computed(() => Boolean(designContextStore.selectedSource.value))
const implementationProjectFiles = designContextStore.projectBuildFiles
const implementationHardwareFiles = designContextStore.hardwareBuildFiles

const reusableSynthesizedEdifPath = computed(() => {
  return synthesisCatalogStore.currentReusableSynthesizedEdifPath.value || null
})

const hasReusableSynthesisArtifact = computed(() => {
  return Boolean(synthesisCatalogStore.currentReusableSynthesizedEdifPath.value)
})

const currentConstraintAssignments = implementationCatalogStore.currentConstraintAssignments

const fullyMapped = computed(() => {
  const topSignals = signalCatalogStore.signals.value
  if (topSignals.length === 0) {
    return true
  }

  return currentConstraintAssignments.value.length === topSignals.length
})

const implementationConstraintXml = implementationCatalogStore.currentConstraintXml
const implementationSourceLabel = computed(() => {
  return designContextStore.sourceName.value || t('topFileNotSelected')
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

const readinessChecklist = computed<ImplementationReadinessChecklistItem[]>(() => [
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

const blockingState = computed<ImplementationBlockingStateViewModel | null>(() => {
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
    return statusBadgeClass('running')
  }

  if (implementationReport.value?.success) {
    return statusBadgeClass('success')
  }

  if (implementationReport.value && !implementationReport.value.success) {
    return statusBadgeClass('danger')
  }

  return statusBadgeClass('default')
})

const implementationHeaderMeta = computed(() => {
  return implementationReport.value
    ? formatDuration(implementationReport.value.elapsed_ms)
    : implementationSourceLabel.value
})

const implementationReportSnapshot = computed<ImplementationReportV1 | null>(() => {
  if (!implementationReport.value) {
    return null
  }

  return {
    ...implementationReport.value,
    stages: implementationReport.value.stages.map((stage) => ({
      ...stage,
    })),
  }
})

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
</script>

<template>
  <NewProjectDialog v-model:open="showNewProjectDialog" />

  <div
    class="flex h-full min-h-0 flex-col gap-6 overflow-x-hidden overflow-y-auto p-8 animate-in fade-in duration-500"
  >
    <div class="flex items-center justify-between shrink-0 gap-4">
      <div>
        <h2 class="text-3xl font-bold tracking-tight">{{ t('implementation') }}</h2>
        <p class="text-muted-foreground">
          {{ t('implementationDescription', { name: implementationSourceLabel }) }}
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
          {{ isBusy ? t('implementationRunningEllipsis') : t('runImplementation') }}
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

    <ImplementationBlockingState
      v-if="blockingState"
      :blocking-state="blockingState"
      :readiness-checklist="readinessChecklist"
    />

    <ImplementationStagesPanel
      v-else
      :report="implementationReportSnapshot"
      :live-log="implementationLiveLog"
    />
  </div>
</template>
