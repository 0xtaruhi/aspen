import { computed, readonly } from 'vue'

import { buildImplementationInputSignature } from '@/lib/implementation-request-signature'
import { createFlowReportSelection } from '@/lib/flow-report-selection'
import { buildConstraintXml, resolveCurrentProjectPinConstraints } from '@/lib/project-constraints'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'
import { projectStore } from '@/stores/project'
import { signalCatalogStore } from '@/stores/signal-catalog'

const currentConstraintAssignments = computed(() => {
  return resolveCurrentProjectPinConstraints(
    projectStore.pinConstraints,
    projectStore.topFileId,
    signalCatalogStore.signals.value,
  )
})

const currentConstraintXml = computed(() => {
  return buildConstraintXml(
    designContextStore.primaryModule.value,
    currentConstraintAssignments.value,
  )
})

const currentImplementationSignature = computed(() => {
  return buildImplementationInputSignature(
    designContextStore.primaryModule.value,
    projectStore.targetDeviceId,
    currentConstraintXml.value,
    projectStore.implementationSettings.placeMode,
    designContextStore.projectBuildFiles.value,
  )
})

const implementationReportSelection = createFlowReportSelection({
  latestReport: hardwareStore.implementationReport,
  latestSignature: hardwareStore.implementationReportSignature,
  currentSignature: currentImplementationSignature,
})

const latestImplementationReport = implementationReportSelection.latestReport
const currentImplementationReport = implementationReportSelection.currentReport

const latestImplementationBitstreamPath = computed(() => {
  return latestImplementationReport.value?.artifacts.bitstream_path?.trim() ?? ''
})

const hasStaleImplementationReport = implementationReportSelection.hasStaleReport

const currentImplementationBitstreamPath = computed(() => {
  return currentImplementationReport.value?.artifacts.bitstream_path?.trim() ?? ''
})

export const implementationCatalogStore = {
  currentImplementationReport: readonly(currentImplementationReport),
  latestImplementationReport: readonly(latestImplementationReport),
  latestImplementationBitstreamPath: readonly(latestImplementationBitstreamPath),
  currentImplementationBitstreamPath: readonly(currentImplementationBitstreamPath),
  hasStaleImplementationReport: readonly(hasStaleImplementationReport),
}
