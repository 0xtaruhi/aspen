import type { SynthesisCellTypeCountV1, SynthesisStatsV1 } from '@/lib/hardware-client'

export type ResourceSummaryStats = Pick<SynthesisStatsV1, 'memory_count'> & {
  cell_type_counts: readonly SynthesisCellTypeCountV1[]
}

export function summarizeSynthesisResources(stats: ResourceSummaryStats | null) {
  let lut = 0
  let ff = 0
  const bram = stats?.memory_count ?? 0
  let dsp = 0

  for (const entry of stats?.cell_type_counts ?? []) {
    const cellType = entry.cell_type.toUpperCase()

    if (/^LUT\d+$/.test(cellType)) {
      lut += entry.count
      continue
    }

    if (/DFF|EDFF|LATCH/.test(cellType)) {
      ff += entry.count
      continue
    }

    if (/DSP|MULT|MAC/.test(cellType)) {
      dsp += entry.count
    }
  }

  return { lut, ff, bram, dsp }
}
