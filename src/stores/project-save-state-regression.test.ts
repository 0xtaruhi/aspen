import { describe, expect, it } from 'vitest'

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

    expect(projectStore.toSnapshot().targetDeviceId).toBe(defaultFpgaDeviceId)

    projectStore.loadFromSnapshot({
      version: 1,
      name: 'LoadedDeviceProject',
      files: projectStore.toSnapshot().files,
      activeFileId: '1',
      topFileId: '1',
      targetDeviceId: 'FDP3P7',
    })

    expect(projectStore.targetDeviceId).toBe('FDP3P7')
    expect(projectStore.toSnapshot().targetDeviceId).toBe('FDP3P7')
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
  })
})
