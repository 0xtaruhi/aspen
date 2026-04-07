import { computed, readonly } from 'vue'

import { buildImplementationInputSignature } from '@/lib/implementation-request-signature'
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

const latestImplementationReport = computed(() => {
  return hardwareStore.implementationReport.value
})

const currentImplementationReport = computed(() => {
  const report = latestImplementationReport.value
  if (!report) {
    return null
  }

  return hardwareStore.implementationReportSignature.value === currentImplementationSignature.value
    ? report
    : null
})

const hasStaleImplementationReport = computed(() => {
  return Boolean(latestImplementationReport.value) && !currentImplementationReport.value
})

const currentImplementationBitstreamPath = computed(() => {
  return currentImplementationReport.value?.artifacts.bitstream_path?.trim() ?? ''
})

export const implementationCatalogStore = {
  currentImplementationReport: readonly(currentImplementationReport),
  latestImplementationReport: readonly(latestImplementationReport),
  currentImplementationBitstreamPath: readonly(currentImplementationBitstreamPath),
  hasStaleImplementationReport: readonly(hasStaleImplementationReport),
}
