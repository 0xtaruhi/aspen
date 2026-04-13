import { describe, expect, it } from 'vitest'

import { defaultFpgaBoardId } from '../lib/fpga-board-catalog'
import { createCanvasDeviceSnapshot } from '../lib/canvas-devices'
import { defaultFpgaDeviceId } from '../lib/fpga-device-catalog'
import { defaultImplementationSettings } from '../lib/implementation-settings'
import { resolveCurrentProjectPinConstraints } from '../lib/project-constraints'

import { projectStore } from './project'
import { projectCanvasStore } from './project-canvas'

describe('project save-state regression', () => {
  it('can return to an empty workspace without a default project', () => {
    projectStore.createNewProject('TemporaryProject', 'empty')

    expect(projectStore.hasProject).toBe(true)
    expect(projectStore.files[0]?.children ?? []).toEqual([])
    expect(projectStore.activeFileId).toBe('')
    expect(projectStore.topFileId).toBe('')

    projectStore.clearProject()

    expect(projectStore.hasProject).toBe(false)
    expect(projectStore.files).toEqual([])
    expect(projectStore.activeFileId).toBe('')
    expect(projectStore.topFileId).toBe('')
    expect(projectStore.hasUnsavedChanges).toBe(false)
  })

  it('tracks dirty files and clears them after marking the project saved', () => {
    projectStore.createNewProject('SaveStateProject', 'blinky')

    expect(projectStore.hasUnsavedChanges).toBe(false)
    expect(projectStore.isFileDirty('1')).toBe(false)

    projectStore.updateCode(`${projectStore.code}\nassign debug = 1'b0;`)

    expect(projectStore.hasUnsavedChanges).toBe(true)
    expect(projectStore.isFileDirty('1')).toBe(true)

    projectStore.markSaved('/tmp/save-state-project.aspen.json')

    expect(projectStore.hasUnsavedChanges).toBe(false)
    expect(projectStore.isFileDirty('1')).toBe(false)
    expect(projectStore.projectPath).toBe('/tmp/save-state-project.aspen.json')
  })

  it('persists the project target device in snapshots', () => {
    projectStore.createNewProject('DeviceProject', 'blinky')
    projectStore.setTopModuleName('custom_top')

    expect(projectStore.toSnapshot().targetDeviceId).toBe(defaultFpgaDeviceId)
    expect(projectStore.toSnapshot().targetBoardId).toBe(defaultFpgaBoardId)
    expect(projectStore.toSnapshot().topModuleName).toBe('custom_top')
    expect(projectStore.toSnapshot().implementationSettings).toEqual(defaultImplementationSettings)

    projectStore.loadFromSnapshot({
      version: 1,
      name: 'LoadedDeviceProject',
      files: projectStore.toSnapshot().files,
      activeFileId: '1',
      topFileId: '1',
      topModuleName: 'loaded_top',
      targetDeviceId: 'FDP3P7',
      targetBoardId: 'FDP3P7_REFERENCE',
      implementationSettings: {
        version: 1,
        placeMode: 'bounding_box',
        routeMode: 'direct_search',
      },
      pinConstraints: {
        version: 1,
        topFileId: '1',
        assignments: [
          {
            portName: 'clk',
            pinId: 'P77',
            boardFunction: 'CLK',
          },
        ],
      },
    })

    expect(projectStore.targetDeviceId).toBe('FDP3P7')
    expect(projectStore.targetBoardId).toBe('FDP3P7_REFERENCE')
    expect(projectStore.topModuleName).toBe('loaded_top')
    expect(projectStore.toSnapshot().targetDeviceId).toBe('FDP3P7')
    expect(projectStore.toSnapshot().targetBoardId).toBe('FDP3P7_REFERENCE')
    expect(projectStore.toSnapshot().topModuleName).toBe('loaded_top')
    expect(projectStore.toSnapshot().implementationSettings).toEqual({
      version: 1,
      placeMode: 'bounding_box',
    })
    expect(projectStore.pinConstraints.assignments).toEqual([
      {
        portName: 'clk',
        pinId: 'P77',
        ioStandard: null,
        pull: null,
        drive: null,
        slew: null,
        clockPeriodNs: null,
        boardFunction: 'CLK',
      },
    ])
  })

  it('falls back to the default target device for legacy snapshots', () => {
    projectStore.createNewProject('LegacyProjectSeed', 'blinky')

    projectStore.loadFromSnapshot({
      version: 1,
      name: 'LegacyProject',
      files: projectStore.toSnapshot().files,
      activeFileId: '1',
      topFileId: '1',
    })

    expect(projectStore.targetDeviceId).toBe(defaultFpgaDeviceId)
    expect(projectStore.topModuleName).toBe('')
    expect(projectStore.implementationSettings).toEqual(defaultImplementationSettings)
  })

  it('retargets persisted pin constraints when the saved top-file id is stale', () => {
    projectStore.createNewProject('ConstraintRecoveryProject', 'blinky')

    const snapshot = projectStore.toSnapshot()
    const currentTopFileId = snapshot.topFileId

    projectStore.loadFromSnapshot({
      ...snapshot,
      pinConstraints: {
        version: 1,
        topFileId: 'missing-top-file',
        assignments: [
          {
            portName: 'clk',
            pinId: 'P77',
            boardFunction: 'CLK',
          },
        ],
      },
    })

    expect(projectStore.topFileId).toBe(currentTopFileId)
    expect(projectStore.pinConstraints.topFileId).toBe(currentTopFileId)
    expect(
      resolveCurrentProjectPinConstraints(projectStore.pinConstraints, projectStore.topFileId, [
        {
          name: 'clk',
          direction: 'input',
          width: '',
          bitName: 'clk',
          baseName: 'clk',
          bitIndex: null,
        },
      ]),
    ).toEqual([
      {
        portName: 'clk',
        pinId: 'P77',
        ioStandard: null,
        pull: null,
        drive: null,
        slew: null,
        clockPeriodNs: null,
        boardFunction: 'CLK',
      },
    ])
  })

  it('persists synthesis cache snapshots with the project', () => {
    projectStore.createNewProject('SynthProject', 'blinky')
    projectStore.setSynthesisCache({
      version: 1,
      signature: 'sig-123',
      report: {
        version: 1,
        op_id: 'op-1',
        success: true,
        top_module: 'blinky',
        source_count: 1,
        tool_path: '/tmp/yosys',
        elapsed_ms: 123,
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
          sequential_cell_count: 1,
          cell_type_counts: [{ cell_type: 'DFFRHQ', count: 1 }],
        },
        top_ports: [{ name: 'clk', direction: 'input', width: '1' }],
        generated_at_ms: 123,
      },
    })

    const snapshot = projectStore.toSnapshot()
    expect(snapshot.synthesisCache?.signature).toBe('sig-123')
    expect(snapshot.synthesisCache?.report.top_module).toBe('blinky')

    projectStore.loadFromSnapshot(snapshot)

    expect(projectStore.synthesisCache?.signature).toBe('sig-123')
    expect(projectStore.synthesisCache?.report.top_module).toBe('blinky')
    expect(projectStore.synthesisCache?.report.stats.cell_count).toBe(1)
  })

  it('persists implementation cache snapshots with the project', () => {
    projectStore.createNewProject('ImplProject', 'blinky')
    projectStore.setImplementationCache({
      version: 1,
      signature: 'impl-sig-123',
      report: {
        version: 1,
        op_id: 'impl-op-1',
        success: true,
        timing_success: true,
        top_module: 'blinky',
        source_count: 1,
        elapsed_ms: 456,
        log: 'implementation ok',
        stages: [],
        artifacts: {
          work_dir: '/tmp/impl',
          constraint_path: '/tmp/impl/top_cons.xml',
          edif_path: '/tmp/impl/top.edf',
          map_path: '/tmp/impl/top_map.xml',
          pack_path: '/tmp/impl/top_pack.xml',
          place_path: '/tmp/impl/top_place.xml',
          route_path: '/tmp/impl/top_route.xml',
          sta_output_path: '/tmp/impl/top.sta.out',
          sta_report_path: '/tmp/impl/top.sta.rpt',
          bitstream_path: '/tmp/impl/top.bit',
        },
        timing_report: 'timing met',
        generated_at_ms: 456,
      },
    })

    const snapshot = projectStore.toSnapshot()
    expect(snapshot.implementationCache?.signature).toBe('impl-sig-123')
    expect(snapshot.implementationCache?.report.top_module).toBe('blinky')

    projectStore.loadFromSnapshot(snapshot)

    expect(projectStore.implementationCache?.signature).toBe('impl-sig-123')
    expect(projectStore.implementationCache?.report.top_module).toBe('blinky')
    expect(projectStore.implementationCache?.report.artifacts.bitstream_path).toBe(
      '/tmp/impl/top.bit',
    )
  })

  it('persists virtual device canvas snapshots with the project', () => {
    projectStore.createNewProject('WorkbenchProject', 'empty')

    const led = createCanvasDeviceSnapshot('led', 'led-1', 120, 80, 1)
    led.label = 'Status LED'
    led.state.is_on = true
    led.state.color = '#22c55e'
    led.state.binding = {
      kind: 'single',
      signal: 'io_gameover',
    }

    const switchDevice = createCanvasDeviceSnapshot('switch', 'switch-1', 80, 160, 2)
    switchDevice.label = 'Run Switch'
    switchDevice.state.is_on = true
    switchDevice.state.binding = {
      kind: 'single',
      signal: 'run_enable',
    }

    const button = createCanvasDeviceSnapshot('button', 'button-1', 80, 240, 3)
    button.label = 'Reset Button'
    button.state.is_on = true
    button.state.binding = {
      kind: 'single',
      signal: 'reset_n',
    }

    const dip = createCanvasDeviceSnapshot('dip_switch_bank', 'dip-1', 120, 320, 4)
    dip.label = 'Config DIP'
    dip.state.binding = {
      kind: 'slots',
      signals: ['cfg0', 'cfg1', 'cfg2', 'cfg3', 'cfg4', 'cfg5', 'cfg6', 'cfg7'],
    }
    dip.state.data = {
      kind: 'bitset',
      bits: [true, false, true, false, false, true, false, true],
    }

    const matrix = createCanvasDeviceSnapshot('led_matrix', 'matrix-1', 240, 160, 1)
    matrix.label = 'Matrix A'
    matrix.state.color = '#eab308'
    matrix.state.config = {
      kind: 'led_matrix',
      rows: 8,
      columns: 8,
    }
    matrix.state.binding = {
      kind: 'slots',
      signals: ['row0', 'row1', 'col0', 'col1'],
    }

    const vga = createCanvasDeviceSnapshot('vga_display', 'vga-1', 360, 180, 1)
    vga.label = 'Workbench VGA'
    vga.state.config = {
      kind: 'vga_display',
      rows: 240,
      columns: 320,
      color_mode: 'rgb565',
    }
    vga.state.binding = {
      kind: 'slots',
      signals: [
        'hsync',
        'vsync',
        'r0',
        'r1',
        'r2',
        'r3',
        'r4',
        'g0',
        'g1',
        'g2',
        'g3',
        'g4',
        'g5',
        'b0',
        'b1',
        'b2',
        'b3',
        'b4',
      ],
    }

    const uart = createCanvasDeviceSnapshot('uart_terminal', 'uart-1', 420, 260, 5)
    uart.label = 'UART Console'
    uart.state.data = {
      kind: 'queued_bytes',
      bytes: [0x41, 0x42, 0x43],
    }

    projectCanvasStore.setCanvasDevices([led, switchDevice, button, dip, matrix, vga, uart])

    const snapshot = projectStore.toSnapshot()
    expect(snapshot.canvasDevices).toHaveLength(7)
    expect(snapshot.canvasDevices[0]?.label).toBe('Status LED')
    expect(snapshot.canvasDevices[0]?.state.is_on).toBe(false)
    expect(snapshot.canvasDevices[1]?.state.is_on).toBe(true)
    expect(snapshot.canvasDevices[2]?.state.is_on).toBe(false)
    expect(snapshot.canvasDevices[3]?.state.data).toEqual({
      kind: 'bitset',
      bits: [true, false, true, false, false, true, false, true],
    })
    expect(snapshot.canvasDevices[4]?.state.config).toEqual({
      kind: 'led_matrix',
      rows: 8,
      columns: 8,
    })
    expect(snapshot.canvasDevices[5]?.state.config).toEqual({
      kind: 'vga_display',
      rows: 240,
      columns: 320,
      color_mode: 'rgb565',
    })
    expect(snapshot.canvasDevices[6]?.state.data).toEqual({
      kind: 'none',
    })

    projectCanvasStore.setCanvasDevices([])
    projectStore.loadFromSnapshot(snapshot)

    expect(projectCanvasStore.canvasDevices.value).toHaveLength(7)
    expect(projectCanvasStore.canvasDevices.value[0]?.label).toBe('Status LED')
    expect(projectCanvasStore.canvasDevices.value[0]?.state.binding).toEqual({
      kind: 'single',
      signal: 'io_gameover',
    })
    expect(projectCanvasStore.canvasDevices.value[0]?.state.is_on).toBe(false)
    expect(projectCanvasStore.canvasDevices.value[1]?.state.is_on).toBe(true)
    expect(projectCanvasStore.canvasDevices.value[2]?.state.is_on).toBe(false)
    expect(projectCanvasStore.canvasDevices.value[3]?.state.data).toEqual({
      kind: 'bitset',
      bits: [true, false, true, false, false, true, false, true],
    })
    expect(projectCanvasStore.canvasDevices.value[4]?.state.color).toBe('#eab308')
    expect(projectCanvasStore.canvasDevices.value[5]?.state.config).toEqual({
      kind: 'vga_display',
      rows: 240,
      columns: 320,
      color_mode: 'rgb565',
    })
    expect(projectCanvasStore.canvasDevices.value[6]?.state.data).toEqual({
      kind: 'none',
    })
  })

  it('only marks persistent virtual device state as unsaved', () => {
    projectStore.createNewProject('VirtualDeviceDirtyStateProject', 'empty')

    const switchDevice = createCanvasDeviceSnapshot('switch', 'switch-dirty', 40, 40, 1)
    const button = createCanvasDeviceSnapshot('button', 'button-dirty', 140, 40, 2)
    const dip = createCanvasDeviceSnapshot('dip_switch_bank', 'dip-dirty', 240, 40, 3)

    projectCanvasStore.setCanvasDevices([switchDevice, button, dip])
    projectStore.markSaved(null)

    projectCanvasStore.applyAction({
      type: 'set_canvas_switch_state',
      id: 'button-dirty',
      is_on: true,
    })
    expect(projectStore.hasUnsavedChanges).toBe(false)

    projectCanvasStore.applyAction({
      type: 'set_canvas_switch_state',
      id: 'switch-dirty',
      is_on: true,
    })
    expect(projectStore.hasUnsavedChanges).toBe(true)

    projectStore.markSaved(null)

    const persistedDip = projectCanvasStore.canvasDevices.value.find(
      (device) => device.id === 'dip-dirty',
    )
    expect(persistedDip).toBeTruthy()
    if (!persistedDip) {
      return
    }

    projectCanvasStore.applyAction({
      type: 'upsert_canvas_device',
      device: {
        ...persistedDip,
        state: {
          ...persistedDip.state,
          data: {
            kind: 'bitset',
            bits: [true, false, true, false, false, false, false, false],
          },
        },
      },
    })

    expect(projectStore.hasUnsavedChanges).toBe(true)
  })
})
