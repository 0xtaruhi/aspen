import { computed, readonly } from 'vue'

import { createFlowReportSelection } from '@/lib/flow-report-selection'
import { buildSynthesisInputSignature } from '@/lib/synthesis-request-signature'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'

const currentSynthesisSignature = computed(() => {
  return buildSynthesisInputSignature(
    designContextStore.primaryModule.value,
    designContextStore.projectBuildFiles.value,
  )
})

const synthesisReportSelection = createFlowReportSelection({
  latestReport: hardwareStore.synthesisReport,
  latestSignature: hardwareStore.synthesisReportSignature,
  currentSignature: currentSynthesisSignature,
})

export const synthesisCatalogStore = {
  currentSynthesisReport: readonly(synthesisReportSelection.currentReport),
  latestSynthesisReport: readonly(synthesisReportSelection.latestReport),
  hasStaleSynthesisReport: readonly(synthesisReportSelection.hasStaleReport),
}
