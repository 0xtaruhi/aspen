import { describe, expect, it } from 'vitest'

import { defaultFpgaBoardId } from '../lib/fpga-board-catalog'
import { defaultFpgaDeviceId } from '../lib/fpga-device-catalog'

import { projectStore } from './project'

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

    projectStore.loadFromSnapshot({
      version: 1,
      name: 'LoadedDeviceProject',
      files: projectStore.toSnapshot().files,
      activeFileId: '1',
      topFileId: '1',
      topModuleName: 'loaded_top',
      targetDeviceId: 'FDP3P7',
      targetBoardId: 'FDP3P7_REFERENCE',
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
  })
})
