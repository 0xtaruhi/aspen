import { nextTick } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ImplementationReportV1, SynthesisReportV1 } from '@/lib/hardware-client'
import { buildImplementationInputSignature } from '@/lib/implementation-request-signature'
import { buildConstraintXml } from '@/lib/project-constraints'
import { buildSynthesisInputSignature } from '@/lib/synthesis-request-signature'
import type { ProjectSnapshot } from '@/stores/project'

import { designContextStore } from './design-context'
import { implementationCatalogStore } from './implementation-catalog'
import { programmingCatalogStore } from './programming-catalog'
import { projectStore } from './project'
import { signalCatalogStore } from './signal-catalog'
import { synthesisCatalogStore } from './synthesis-catalog'

function createProjectSnapshot(): ProjectSnapshot {
  const fileContent = `module Dino_Top(input wire clk, output wire led);
  assign led = clk;
endmodule`

  const files = [
    {
      id: 'root',
      name: 'Dino',
      type: 'folder' as const,
      isOpen: true,
      children: [
        {
          id: 'top-file',
          name: 'Top.v',
          type: 'file' as const,
          content: fileContent,
        },
      ],
    },
  ]

  const sourceFiles = [{ path: 'Dino/Top.v', content: fileContent }]
  const topModuleName = 'Dino_Top'
  const constraintAssignments = [
    { portName: 'clk', pinId: 'P77', boardFunction: 'CLK' },
    { portName: 'led', pinId: 'P7' },
  ]
  const constraintXml = buildConstraintXml(topModuleName, constraintAssignments)

  const synthesisReport: SynthesisReportV1 = {
    version: 1,
    op_id: 'synth-op',
    success: true,
    top_module: topModuleName,
    source_count: sourceFiles.length,
    tool_path: '/tmp/yosys',
    elapsed_ms: 10,
    warnings: 0,
    errors: 0,
    log: 'ok',
    stats: {
      wire_count: 1,
      wire_bits: 2,
      public_wire_count: 1,
      public_wire_bits: 2,
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

  const implementationReport: ImplementationReportV1 = {
    version: 1,
    op_id: 'impl-op',
    success: true,
    timing_success: true,
    top_module: topModuleName,
    source_count: sourceFiles.length,
    elapsed_ms: 20,
    log: 'ok',
    stages: [],
    artifacts: {
      work_dir: '/tmp/impl',
      constraint_path: '/tmp/impl/constraints.xml',
      edif_path: '/tmp/impl/top.edf',
      map_path: '/tmp/impl/top.map.xml',
      pack_path: '/tmp/impl/top.pack.xml',
      place_path: '/tmp/impl/top.place.xml',
      route_path: '/tmp/impl/top.route.xml',
      sta_output_path: null,
      sta_report_path: null,
      bitstream_path: '/tmp/impl/top.bit',
    },
    timing_report: 'timing ok',
    generated_at_ms: 2,
  }

  return {
    version: 2,
    content: {
      name: 'Dino',
      files,
      topFileId: 'top-file',
      topModuleName,
      targetDeviceId: projectStore.targetDeviceId,
      targetBoardId: projectStore.targetBoardId,
      pinConstraints: {
        version: 1,
        topFileId: 'top-file',
        assignments: constraintAssignments,
      },
      implementationSettings: {
        version: 1,
        placeMode: projectStore.implementationSettings.placeMode,
      },
      synthesisCache: {
        version: 1,
        signature: buildSynthesisInputSignature(topModuleName, sourceFiles),
        report: synthesisReport,
      },
      implementationCache: {
        version: 1,
        signature: buildImplementationInputSignature(
          topModuleName,
          projectStore.targetDeviceId,
          constraintXml,
          projectStore.implementationSettings.placeMode,
          sourceFiles,
        ),
        report: implementationReport,
      },
      canvasDevices: [],
      waveformView: {
        version: 1,
        signalOrder: [],
        signalColorOverrides: {},
      },
    },
    workspaceView: {
      activeFileId: 'top-file',
    },
  }
}

describe('project open regression', () => {
  beforeEach(() => {
    projectStore.clearProject()
  })

  it('keeps the current synthesis and bitstream catalogs available after loading a saved project', async () => {
    projectStore.loadFromSnapshot(createProjectSnapshot(), {
      projectPath: '/tmp/Dino/aspen.project.json',
    })

    await nextTick()

    expect(designContextStore.hardwareBuildFiles.value).toHaveLength(1)
    expect(designContextStore.primaryModule.value).toBe('Dino_Top')
    expect(synthesisCatalogStore.currentSynthesisReport.value?.success).toBe(true)
    expect(signalCatalogStore.signalSourceReport.value?.success).toBe(true)
    expect(implementationCatalogStore.currentImplementationReport.value?.success).toBe(true)
    expect(programmingCatalogStore.defaultBitstreamPath.value).toBe('/tmp/impl/top.bit')
  })
})
