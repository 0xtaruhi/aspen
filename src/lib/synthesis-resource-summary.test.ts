import type { ResourceSummaryStats } from './synthesis-resource-summary'

import { describe, expect, it } from 'vitest'

import { summarizeSynthesisResources } from './synthesis-resource-summary'

describe('summarizeSynthesisResources', () => {
  it('counts LUT2, LUT3, and LUT4 cells toward total LUT usage', () => {
    const stats: ResourceSummaryStats = {
      memory_count: 2,
      cell_type_counts: [
        { cell_type: 'LUT2', count: 3 },
        { cell_type: 'lut3', count: 4 },
        { cell_type: 'LUT4', count: 5 },
        { cell_type: 'DFFRHQ', count: 6 },
        { cell_type: 'LATCH', count: 7 },
        { cell_type: 'DSP48', count: 8 },
      ],
    }

    expect(summarizeSynthesisResources(stats)).toEqual({
      lut: 12,
      ff: 13,
      bram: 2,
      dsp: 8,
    })
  })
})
