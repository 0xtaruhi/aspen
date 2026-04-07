import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import type { SynthesisReportV1 } from '@/lib/hardware-client'
import { CURRENT_SYNTHESIS_ARTIFACT_FLOW_REVISION } from '@/lib/synthesis-artifact-flow'
import { buildSynthesisInputSignature } from '@/lib/synthesis-request-signature'

import { designContextStore } from './design-context'
import { projectStore } from './project'
import { synthesisCatalogStore } from './synthesis-catalog'

function createSynthesisReport(options?: {
  flowRevision?: string
  success?: boolean
}): SynthesisReportV1 {
  return {
    version: 1,
    op_id: 'synth-op',
    success: options?.success ?? true,
    top_module: designContextStore.primaryModule.value,
    source_count: designContextStore.projectBuildFiles.value.length,
    tool_path: '/tmp/yosys',
    elapsed_ms: 1,
    warnings: 0,
    errors: options?.success === false ? 1 : 0,
    log: 'ok',
    stats: {
      wire_count: 1,
      wire_bits: 1,
      public_wire_count: 1,
      public_wire_bits: 1,
      memory_count: 0,
      memory_bits: 0,
      cell_count: 1,
      sequential_cell_count: 0,
      cell_type_counts: [],
    },
    top_ports: [
      { name: 'clk', direction: 'input', width: '1' },
      { name: 'led', direction: 'output', width: '1' },
    ],
    artifacts: {
      work_dir: '/tmp/synth',
      script_path: null,
      netlist_json_path: null,
      edif_path: '/tmp/synth/top.edf',
      flow_revision: options?.flowRevision ?? CURRENT_SYNTHESIS_ARTIFACT_FLOW_REVISION,
    },
    generated_at_ms: 1,
  }
}

describe('synthesis catalog regression', () => {
  beforeEach(() => {
    projectStore.clearProject()
    projectStore.createNewProject('SynthCatalogProject', 'blinky')
  })

  it('keeps the reusable EDIF path only while the current synthesis signature still matches', async () => {
    projectStore.setSynthesisCache({
      version: 1,
      signature: buildSynthesisInputSignature(
        designContextStore.primaryModule.value,
        designContextStore.projectBuildFiles.value,
      ),
      report: createSynthesisReport(),
    })

    await nextTick()

    expect(synthesisCatalogStore.currentSynthesisReport.value?.success).toBe(true)
    expect(synthesisCatalogStore.hasCurrentSynthesisReport.value).toBe(true)
    expect(synthesisCatalogStore.hasStaleSynthesisReport.value).toBe(false)
    expect(synthesisCatalogStore.currentReusableSynthesizedEdifPath.value).toBe(
      '/tmp/synth/top.edf',
    )

    const topFile = projectStore.topFile
    if (!topFile || topFile.type !== 'file') {
      throw new Error('Expected a top file fixture.')
    }

    topFile.content = `${topFile.content ?? ''}\n// change`

    await nextTick()

    expect(synthesisCatalogStore.currentSynthesisReport.value).toBeNull()
    expect(synthesisCatalogStore.latestSynthesisReport.value?.success).toBe(true)
    expect(synthesisCatalogStore.hasCurrentSynthesisReport.value).toBe(false)
    expect(synthesisCatalogStore.hasStaleSynthesisReport.value).toBe(true)
    expect(synthesisCatalogStore.currentReusableSynthesizedEdifPath.value).toBe('')
    expect(synthesisCatalogStore.latestReusableSynthesizedEdifPath.value).toBe('/tmp/synth/top.edf')
  })

  it('rejects stale synthesis artifacts with an incompatible flow revision', async () => {
    projectStore.setSynthesisCache({
      version: 1,
      signature: buildSynthesisInputSignature(
        designContextStore.primaryModule.value,
        designContextStore.projectBuildFiles.value,
      ),
      report: createSynthesisReport({
        flowRevision: 'legacy-yosys-json-v1',
      }),
    })

    await nextTick()

    expect(synthesisCatalogStore.currentSuccessfulSynthesisReport.value?.success).toBe(true)
    expect(synthesisCatalogStore.currentReusableSynthesizedEdifPath.value).toBe('')
  })
})
