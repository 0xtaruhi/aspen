import { computed, readonly } from 'vue'

import { buildImplementationInputSignature } from '@/lib/implementation-request-signature'
import { buildConstraintXml, resolveCurrentProjectPinConstraints } from '@/lib/project-constraints'
import { designContextStore } from '@/stores/design-context'
import { createFlowCatalog } from '@/stores/flow-catalog'
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

const implementationCatalog = createFlowCatalog({
  latestReport: hardwareStore.implementationReport,
  latestSignature: hardwareStore.implementationReportSignature,
  currentSignature: currentImplementationSignature,
})

const latestImplementationBitstreamPath = computed(() => {
  return implementationCatalog.latestReport.value?.artifacts.bitstream_path?.trim() ?? ''
})

const currentImplementationBitstreamPath = computed(() => {
  return implementationCatalog.currentReport.value?.artifacts.bitstream_path?.trim() ?? ''
})

export const implementationCatalogStore = {
  currentConstraintAssignments: readonly(currentConstraintAssignments),
  currentConstraintXml: readonly(currentConstraintXml),
  currentImplementationSignature: implementationCatalog.currentSignature,
  latestImplementationSignature: implementationCatalog.latestSignature,
  currentImplementationReport: implementationCatalog.currentReport,
  latestImplementationReport: implementationCatalog.latestReport,
  hasCurrentImplementationReport: implementationCatalog.hasCurrentReport,
  hasLatestImplementationReport: implementationCatalog.hasLatestReport,
  hasStaleImplementationReport: implementationCatalog.hasStaleReport,
  latestImplementationBitstreamPath: readonly(latestImplementationBitstreamPath),
  currentImplementationBitstreamPath: readonly(currentImplementationBitstreamPath),
}
