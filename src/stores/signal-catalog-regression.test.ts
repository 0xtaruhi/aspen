import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import type { SynthesisReportV1 } from '@/lib/hardware-client'
import { CURRENT_SYNTHESIS_ARTIFACT_FLOW_REVISION } from '@/lib/synthesis-artifact-flow'
import { buildSynthesisInputSignature } from '@/lib/synthesis-request-signature'

import { designContextStore } from './design-context'
import { projectStore } from './project'
import { signalCatalogStore } from './signal-catalog'

function createSynthesisReport(): SynthesisReportV1 {
  return {
    version: 1,
    op_id: 'synth-op',
    success: true,
    top_module: designContextStore.primaryModule.value,
    source_count: designContextStore.projectBuildFiles.value.length,
    tool_path: '/tmp/yosys',
    elapsed_ms: 1,
    warnings: 0,
    errors: 0,
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
      flow_revision: CURRENT_SYNTHESIS_ARTIFACT_FLOW_REVISION,
    },
    generated_at_ms: 1,
  }
}

describe('signal catalog regression', () => {
  beforeEach(() => {
    projectStore.clearProject()
    projectStore.createNewProject('SignalCatalogProject', 'blinky')
    projectStore.setPinConstraint(projectStore.topFileId, {
      portName: 'clk',
      pinId: 'P77',
      boardFunction: 'CLK',
    })
    projectStore.setPinConstraint(projectStore.topFileId, {
      portName: 'led',
      pinId: 'P7',
    })
  })

  it('keeps the last successful signal catalog available after sources change', async () => {
    projectStore.setSynthesisCache({
      version: 1,
      signature: buildSynthesisInputSignature(
        designContextStore.primaryModule.value,
        designContextStore.projectBuildFiles.value,
      ),
      report: createSynthesisReport(),
    })

    await nextTick()

    expect(signalCatalogStore.hasSignalSourceReport.value).toBe(true)
    expect(signalCatalogStore.hasStaleSignalSourceReport.value).toBe(false)
    expect(signalCatalogStore.signals.value.map((signal) => signal.bitName)).toEqual(['clk', 'led'])
    expect(signalCatalogStore.workbenchSignals.value.map((signal) => signal.bitName)).toEqual([
      'led',
    ])

    const topFile = projectStore.topFile
    if (!topFile || topFile.type !== 'file') {
      throw new Error('Expected a top file fixture.')
    }

    topFile.content = `${topFile.content ?? ''}\n// make synthesis stale`

    await nextTick()

    expect(signalCatalogStore.hasSignalSourceReport.value).toBe(true)
    expect(signalCatalogStore.hasStaleSignalSourceReport.value).toBe(true)
    expect(signalCatalogStore.signals.value.map((signal) => signal.bitName)).toEqual(['clk', 'led'])
    expect(signalCatalogStore.workbenchSignals.value.map((signal) => signal.bitName)).toEqual([
      'led',
    ])
    expect(signalCatalogStore.streamOutputSignalOrder.value).toContain('led')
  })
})
