import type { ComputedRef, Ref } from 'vue'

import { computed, readonly } from 'vue'

import { createFlowReportSelection } from '@/lib/flow-report-selection'

type ReadableRef<T> = Ref<T> | ComputedRef<T>

type FlowCatalogOptions<T> = {
  latestReport: ReadableRef<T | null>
  latestSignature: ReadableRef<string | null>
  currentSignature: ReadableRef<string>
  acceptReport?: (report: T) => boolean
}

export function createFlowCatalog<T>({
  latestReport,
  latestSignature,
  currentSignature,
  acceptReport,
}: FlowCatalogOptions<T>) {
  const selection = createFlowReportSelection({
    latestReport,
    latestSignature,
    currentSignature,
    acceptReport,
  })

  const hasLatestReport = computed(() => {
    return Boolean(selection.latestReport.value)
  })

  const hasCurrentReport = computed(() => {
    return Boolean(selection.currentReport.value)
  })

  return {
    currentSignature: readonly(computed(() => currentSignature.value)),
    latestSignature: readonly(computed(() => latestSignature.value)),
    latestReport: selection.latestReport,
    currentReport: selection.currentReport,
    hasLatestReport: readonly(hasLatestReport),
    hasCurrentReport: readonly(hasCurrentReport),
    hasStaleReport: selection.hasStaleReport,
  }
}
