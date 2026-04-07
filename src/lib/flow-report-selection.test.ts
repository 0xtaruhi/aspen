import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { createFlowReportSelection } from './flow-report-selection'

describe('flow report selection', () => {
  it('keeps the latest accepted report and exposes the current report only when signatures match', () => {
    const latestReport = ref<{ id: string; success: boolean } | null>({
      id: 'latest',
      success: true,
    })
    const latestSignature = ref('sig-a')
    const currentSignature = ref('sig-a')

    const selection = createFlowReportSelection({
      latestReport,
      latestSignature,
      currentSignature: computed(() => currentSignature.value),
      acceptReport: (report) => report.success,
    })

    expect(selection.latestReport.value?.id).toBe('latest')
    expect(selection.currentReport.value?.id).toBe('latest')
    expect(selection.hasStaleReport.value).toBe(false)

    currentSignature.value = 'sig-b'

    expect(selection.latestReport.value?.id).toBe('latest')
    expect(selection.currentReport.value).toBeNull()
    expect(selection.hasStaleReport.value).toBe(true)
  })

  it('filters out reports rejected by the acceptance predicate', () => {
    const selection = createFlowReportSelection({
      latestReport: ref({ id: 'failed', success: false }),
      latestSignature: ref('sig-a'),
      currentSignature: ref('sig-a'),
      acceptReport: (report) => report.success,
    })

    expect(selection.latestReport.value).toBeNull()
    expect(selection.currentReport.value).toBeNull()
    expect(selection.hasStaleReport.value).toBe(false)
  })
})
