import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { buildImplementationInputSignature } from '@/lib/implementation-request-signature'
import { buildConstraintXml } from '@/lib/project-constraints'
import { buildSynthesisInputSignature } from '@/lib/synthesis-request-signature'
import type { ImplementationReportV1, SynthesisReportV1 } from '@/lib/hardware-client'

import { designContextStore } from './design-context'
import { programmingCatalogStore } from './programming-catalog'
import { projectStore } from './project'

function currentConstraintXml() {
  return buildConstraintXml(
    designContextStore.primaryModule.value,
    projectStore.pinConstraints.assignments,
  )
}

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
      flow_revision: 'test',
    },
    generated_at_ms: 1,
  }
}

function createImplementationReport(bitstreamPath: string): ImplementationReportV1 {
  return {
    version: 1,
    op_id: 'impl-op',
    success: true,
    timing_success: true,
    top_module: designContextStore.primaryModule.value,
    source_count: designContextStore.projectBuildFiles.value.length,
    elapsed_ms: 1,
    log: 'ok',
    stages: [],
    artifacts: {
      work_dir: '/tmp/impl',
      constraint_path: '/tmp/impl/constraints.xml',
      edif_path: '/tmp/impl/top.edf',
      map_path: '/tmp/impl/top.mapped.xml',
      pack_path: '/tmp/impl/top.packed.xml',
      place_path: '/tmp/impl/top.placed.xml',
      route_path: '/tmp/impl/top.routed.xml',
      sta_output_path: null,
      sta_report_path: null,
      bitstream_path: bitstreamPath,
    },
    timing_report: '',
    generated_at_ms: 1,
  }
}

describe('programming catalog regression', () => {
  beforeEach(async () => {
    projectStore.clearProject()
    projectStore.createNewProject('ProgrammingCatalogProject', 'blinky')
    projectStore.setPinConstraint(projectStore.topFileId, {
      portName: 'clk',
      pinId: 'P77',
      boardFunction: 'CLK',
    })
    projectStore.setPinConstraint(projectStore.topFileId, {
      portName: 'led',
      pinId: 'P7',
    })

    projectStore.setSynthesisCache({
      version: 1,
      signature: buildSynthesisInputSignature(
        designContextStore.primaryModule.value,
        designContextStore.projectBuildFiles.value,
      ),
      report: createSynthesisReport(),
    })

    await nextTick()
  })

  it('only exposes a default program bitstream for the current implementation signature', async () => {
    const currentSignature = buildImplementationInputSignature(
      designContextStore.primaryModule.value,
      projectStore.targetDeviceId,
      currentConstraintXml(),
      projectStore.implementationSettings.placeMode,
      designContextStore.projectBuildFiles.value,
    )

    projectStore.setImplementationCache({
      version: 1,
      signature: currentSignature,
      report: createImplementationReport('/tmp/current.bit'),
    })

    await nextTick()

    expect(programmingCatalogStore.defaultBitstreamPath.value).toBe('/tmp/current.bit')
    expect(programmingCatalogStore.hasDefaultBitstream.value).toBe(true)
    expect(programmingCatalogStore.staleBitstreamPath.value).toBe('')
    expect(programmingCatalogStore.hasStaleBitstream.value).toBe(false)

    projectStore.setPinConstraint(projectStore.topFileId, {
      portName: 'led',
      pinId: 'P6',
    })

    await nextTick()

    expect(programmingCatalogStore.defaultBitstreamPath.value).toBe('')
    expect(programmingCatalogStore.hasDefaultBitstream.value).toBe(false)
    expect(programmingCatalogStore.staleBitstreamPath.value).toBe('/tmp/current.bit')
    expect(programmingCatalogStore.hasStaleBitstream.value).toBe(true)
  })
})
