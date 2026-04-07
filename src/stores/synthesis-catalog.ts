import { computed, readonly } from 'vue'

import { CURRENT_SYNTHESIS_ARTIFACT_FLOW_REVISION } from '@/lib/synthesis-artifact-flow'
import { buildSynthesisInputSignature } from '@/lib/synthesis-request-signature'
import { designContextStore } from '@/stores/design-context'
import { createFlowCatalog } from '@/stores/flow-catalog'
import { hardwareStore } from '@/stores/hardware'

const currentSynthesisSignature = computed(() => {
  return buildSynthesisInputSignature(
    designContextStore.primaryModule.value,
    designContextStore.projectBuildFiles.value,
  )
})

const synthesisCatalog = createFlowCatalog({
  latestReport: hardwareStore.synthesisReport,
  latestSignature: hardwareStore.synthesisReportSignature,
  currentSignature: currentSynthesisSignature,
})

const latestSuccessfulSynthesisReport = computed(() => {
  const report = synthesisCatalog.latestReport.value
  return report?.success ? report : null
})

const currentSuccessfulSynthesisReport = computed(() => {
  const report = synthesisCatalog.currentReport.value
  return report?.success ? report : null
})

const hasLatestSuccessfulSynthesisReport = computed(() => {
  return Boolean(latestSuccessfulSynthesisReport.value)
})

const hasCurrentSuccessfulSynthesisReport = computed(() => {
  return Boolean(currentSuccessfulSynthesisReport.value)
})

const hasStaleSuccessfulSynthesisReport = computed(() => {
  return Boolean(latestSuccessfulSynthesisReport.value) && !currentSuccessfulSynthesisReport.value
})

function reusableSynthesizedEdifPath(
  report: {
    artifacts?: {
      edif_path?: string | null
      flow_revision?: string | null
    } | null
  } | null,
) {
  const artifacts = report?.artifacts
  if (!artifacts?.edif_path) {
    return ''
  }

  if (artifacts.flow_revision !== CURRENT_SYNTHESIS_ARTIFACT_FLOW_REVISION) {
    return ''
  }

  return artifacts.edif_path.trim()
}

const currentReusableSynthesizedEdifPath = computed(() => {
  return reusableSynthesizedEdifPath(currentSuccessfulSynthesisReport.value)
})

const latestReusableSynthesizedEdifPath = computed(() => {
  return reusableSynthesizedEdifPath(latestSuccessfulSynthesisReport.value)
})

export const synthesisCatalogStore = {
  currentSynthesisSignature: synthesisCatalog.currentSignature,
  latestSynthesisSignature: synthesisCatalog.latestSignature,
  currentSynthesisReport: synthesisCatalog.currentReport,
  latestSynthesisReport: synthesisCatalog.latestReport,
  hasCurrentSynthesisReport: synthesisCatalog.hasCurrentReport,
  hasLatestSynthesisReport: synthesisCatalog.hasLatestReport,
  hasStaleSynthesisReport: synthesisCatalog.hasStaleReport,
  currentSuccessfulSynthesisReport: readonly(currentSuccessfulSynthesisReport),
  latestSuccessfulSynthesisReport: readonly(latestSuccessfulSynthesisReport),
  hasCurrentSuccessfulSynthesisReport: readonly(hasCurrentSuccessfulSynthesisReport),
  hasLatestSuccessfulSynthesisReport: readonly(hasLatestSuccessfulSynthesisReport),
  hasStaleSuccessfulSynthesisReport: readonly(hasStaleSuccessfulSynthesisReport),
  currentReusableSynthesizedEdifPath: readonly(currentReusableSynthesizedEdifPath),
  latestReusableSynthesizedEdifPath: readonly(latestReusableSynthesizedEdifPath),
}
