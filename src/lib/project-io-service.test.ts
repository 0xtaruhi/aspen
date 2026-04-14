import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('project io service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('returns a structured warning when duplicate imports are skipped', async () => {
    const { projectStore } = await import('@/stores/project')
    const { applyImportedFilesToProject } = await import('./project-io-service')

    projectStore.clearProject()
    projectStore.createNewProject('ImportResultProject', 'empty')
    expect(projectStore.createFile('root', 'dup.v')).toBe(true)

    const result = applyImportedFilesToProject('root', [
      {
        name: 'dup.v',
        content: 'module duplicate; endmodule',
      },
      {
        name: 'init.mem',
        content: '00',
      },
    ])

    expect(result).toEqual({
      kind: 'success',
      value: {
        createdCount: 1,
        skippedNames: ['dup.v'],
      },
      message: {
        key: 'importProjectFilesSkippedDuplicates',
        params: {
          count: 1,
          names: 'dup.v',
        },
      },
    })
  })

  it('validates create-project input before filesystem inspection', async () => {
    const { validateCreateProjectAtDirectoryInput } = await import('./project-io-service')

    expect(
      validateCreateProjectAtDirectoryInput({
        name: '   ',
        template: 'empty',
        parentDirectoryPath: '/tmp/aspen',
      }),
    ).toEqual({
      kind: 'failure',
      reason: 'validation',
      message: {
        key: 'projectNameRequired',
      },
    })
  })

  it('forgets missing recent projects when opening from the recent-project service fails', async () => {
    const loadProjectFromPath = vi.fn().mockRejectedValue(new Error('not found'))
    const removeProject = vi.fn()

    vi.doMock('./project-persistence', () => ({
      inspectProjectDirectory: vi.fn(),
      loadProjectFromPath,
      readImportedSourceFiles: vi.fn(),
      syncInMemoryImplementationCacheAfterSave: vi.fn(),
      syncInMemorySynthesisCacheAfterSave: vi.fn(),
      writeProjectBundle: vi.fn(),
    }))
    vi.doMock('@/stores/recent-projects', () => ({
      recentProjectsStore: {
        rememberProject: vi.fn(),
        removeProject,
      },
    }))
    vi.doMock('@/stores/project', () => ({
      projectStore: {
        createNewProject: vi.fn(),
        findNode: vi.fn(),
        importFiles: vi.fn(),
        markSaved: vi.fn(),
        rootNode: null,
        toSnapshot: vi.fn(() => ({
          content: {
            name: 'MockProject',
          },
        })),
      },
    }))

    const { openRecentProjectFromPath } = await import('./project-io-service')

    const result = await openRecentProjectFromPath('/tmp/missing/aspen.project.json')

    expect(loadProjectFromPath).toHaveBeenCalledWith('/tmp/missing/aspen.project.json')
    expect(removeProject).toHaveBeenCalledWith('/tmp/missing/aspen.project.json')
    expect(result).toMatchObject({
      kind: 'failure',
      reason: 'error',
      message: {
        key: 'openProjectFailed',
        params: {
          message: 'not found',
        },
      },
    })
  })

  it('persists saves through a structured result instead of mutating UI state directly', async () => {
    const writeProjectBundle = vi.fn().mockResolvedValue(undefined)
    const syncInMemoryImplementationCacheAfterSave = vi.fn()
    const syncInMemorySynthesisCacheAfterSave = vi.fn()
    const rememberProject = vi.fn()
    const markSaved = vi.fn()

    vi.doMock('./project-persistence', () => ({
      inspectProjectDirectory: vi.fn(),
      loadProjectFromPath: vi.fn(),
      readImportedSourceFiles: vi.fn(),
      syncInMemoryImplementationCacheAfterSave,
      syncInMemorySynthesisCacheAfterSave,
      writeProjectBundle,
    }))
    vi.doMock('@/stores/recent-projects', () => ({
      recentProjectsStore: {
        rememberProject,
        removeProject: vi.fn(),
      },
    }))
    vi.doMock('@/stores/project', () => ({
      projectStore: {
        createNewProject: vi.fn(),
        findNode: vi.fn(),
        importFiles: vi.fn(),
        markSaved,
        rootNode: null,
        toSnapshot: vi.fn(() => ({
          content: {
            name: 'SavedProject',
          },
        })),
      },
    }))

    const { saveProjectBundleToPath } = await import('./project-io-service')

    const result = await saveProjectBundleToPath('/tmp/saved-project/aspen.project.json', {
      preserveArtifacts: true,
    })

    expect(writeProjectBundle).toHaveBeenCalledWith('/tmp/saved-project/aspen.project.json', {
      preserveArtifacts: true,
    })
    expect(syncInMemorySynthesisCacheAfterSave).toHaveBeenCalledWith(true)
    expect(syncInMemoryImplementationCacheAfterSave).toHaveBeenCalledWith(true)
    expect(markSaved).toHaveBeenCalledWith('/tmp/saved-project/aspen.project.json')
    expect(rememberProject).toHaveBeenCalledWith(
      '/tmp/saved-project/aspen.project.json',
      'SavedProject',
    )
    expect(result).toEqual({
      kind: 'success',
      value: {
        path: '/tmp/saved-project/aspen.project.json',
      },
    })
  })
})
