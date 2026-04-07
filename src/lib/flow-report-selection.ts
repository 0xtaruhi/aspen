import type { ComputedRef, Ref } from 'vue'

import { computed, readonly } from 'vue'

type ReadableRef<T> = Ref<T> | ComputedRef<T>

type FlowReportSelectionOptions<T> = {
  latestReport: ReadableRef<T | null>
  latestSignature: ReadableRef<string | null>
  currentSignature: ReadableRef<string>
  acceptReport?: (report: T) => boolean
}

export function createFlowReportSelection<T>({
  latestReport,
  latestSignature,
  currentSignature,
  acceptReport = () => true,
}: FlowReportSelectionOptions<T>) {
  const latestAcceptedReport = computed(() => {
    const report = latestReport.value
    if (!report) {
      return null
    }

    return acceptReport(report) ? report : null
  })

  const currentAcceptedReport = computed(() => {
    const report = latestAcceptedReport.value
    if (!report) {
      return null
    }

    return latestSignature.value === currentSignature.value ? report : null
  })

  const hasStaleAcceptedReport = computed(() => {
    return Boolean(latestAcceptedReport.value) && !currentAcceptedReport.value
  })

  return {
    latestReport: readonly(latestAcceptedReport),
    currentReport: readonly(currentAcceptedReport),
    hasStaleReport: readonly(hasStaleAcceptedReport),
  }
}
