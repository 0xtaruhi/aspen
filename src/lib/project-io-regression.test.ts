import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('project io regressions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('allows importing .mem files anywhere that uses the shared source-file filter', async () => {
    const { PROJECT_IMPORT_SOURCE_FILE_EXTENSIONS } = await import('./project-io')

    expect(PROJECT_IMPORT_SOURCE_FILE_EXTENSIONS).toContain('mem')
  })

  it('shows duplicate-skip warnings after direct file imports succeed', async () => {
    const showProjectIoMessage = vi.fn()
    const applyImportedFilesToProject = vi.fn(() => ({
      kind: 'success' as const,
      value: {
        createdCount: 0,
        skippedNames: ['dup.v'],
      },
      message: {
        key: 'importProjectFilesSkippedDuplicates' as const,
        params: {
          count: 1,
          names: 'dup.v',
        },
      },
    }))

    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn().mockResolvedValue('module duplicate; endmodule'),
    }))
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: vi.fn().mockResolvedValue(['/tmp/dup.v']),
      save: vi.fn(),
    }))
    vi.doMock('@/lib/i18n', () => ({
      translate: vi.fn((key: string) => key),
    }))
    vi.doMock('@/lib/project-layout', () => ({
      ASPEN_PROJECT_FILENAME: 'aspen.project.json',
      getProjectMetadataPath: vi.fn((path: string) => path),
    }))
    vi.doMock('@/lib/project-io-common', () => ({
      getProjectIoErrorMessage: vi.fn((err: unknown) => String(err)),
      isProjectIoTauriUnavailable: vi.fn(() => false),
      showProjectIoMessage,
    }))
    vi.doMock('@/lib/project-io-service', () => ({
      applyImportedFilesToProject,
      finalizeCreateProjectDirectory: vi.fn(),
      openProjectFromPath: vi.fn(),
      openRecentProjectFromPath: vi.fn(),
      prepareCreateProjectDirectory: vi.fn(),
      saveProjectBundleToPath: vi.fn(),
      validateCreateProjectAtDirectoryInput: vi.fn(),
    }))
    vi.doMock('@/stores/hardware', () => ({
      hardwareStore: {},
    }))
    vi.doMock('@/stores/project', () => ({
      projectStore: {
        files: [],
        hasProject: true,
        hasUnsavedChanges: false,
        projectPath: null,
        rootNode: {
          id: 'root',
          type: 'folder',
        },
        toSnapshot: vi.fn(() => ({
          content: {
            name: 'DemoProject',
          },
        })),
      },
    }))
    vi.doMock('@/stores/project-unsaved-changes', () => ({
      requestProjectUnsavedChanges: vi.fn(),
    }))

    const { importProjectFiles } = await import('./project-io')

    expect(await importProjectFiles()).toBe(true)
    expect(showProjectIoMessage).toHaveBeenCalledWith({
      key: 'importProjectFilesSkippedDuplicates',
      params: {
        count: 1,
        names: 'dup.v',
      },
    })
  })

  it('shows create-project warnings returned by the service layer', async () => {
    const showProjectIoMessage = vi.fn()
    const finalizeCreateProjectDirectory = vi.fn().mockResolvedValue({
      kind: 'success',
      value: {
        metadataPath: '/tmp/Demo/aspen.project.json',
      },
      message: {
        key: 'importProjectFilesSkippedDuplicates',
        params: {
          count: 1,
          names: 'dup.v',
        },
      },
    })

    vi.doMock('@tauri-apps/api/core', () => ({
      invoke: vi.fn(),
    }))
    vi.doMock('@tauri-apps/plugin-dialog', () => ({
      open: vi.fn(),
      save: vi.fn(),
    }))
    vi.doMock('@/lib/i18n', () => ({
      translate: vi.fn((key: string) => key),
    }))
    vi.doMock('@/lib/project-layout', () => ({
      ASPEN_PROJECT_FILENAME: 'aspen.project.json',
      getProjectMetadataPath: vi.fn((path: string) => path),
    }))
    vi.doMock('@/lib/project-io-common', () => ({
      getProjectIoErrorMessage: vi.fn((err: unknown) => String(err)),
      isProjectIoTauriUnavailable: vi.fn(() => false),
      showProjectIoMessage,
    }))
    vi.doMock('@/lib/project-io-service', () => ({
      applyImportedFilesToProject: vi.fn(),
      finalizeCreateProjectDirectory,
      openProjectFromPath: vi.fn(),
      openRecentProjectFromPath: vi.fn(),
      prepareCreateProjectDirectory: vi.fn().mockResolvedValue({
        kind: 'success',
        value: {
          parentDirectoryPath: '/tmp',
          projectDirectoryPath: '/tmp/Demo',
          projectName: 'Demo',
        },
      }),
      saveProjectBundleToPath: vi.fn(),
      validateCreateProjectAtDirectoryInput: vi.fn(() => null),
    }))
    vi.doMock('@/stores/hardware', () => ({
      hardwareStore: {},
    }))
    vi.doMock('@/stores/project', () => ({
      projectStore: {
        files: [],
        hasProject: false,
        hasUnsavedChanges: false,
        projectPath: null,
        toSnapshot: vi.fn(() => ({
          content: {
            name: 'DemoProject',
          },
        })),
      },
    }))
    vi.doMock('@/stores/project-unsaved-changes', () => ({
      requestProjectUnsavedChanges: vi.fn(),
    }))

    const { createProjectAtDirectory } = await import('./project-io')

    expect(
      await createProjectAtDirectory({
        name: 'Demo',
        template: 'empty',
        parentDirectoryPath: '/tmp',
      }),
    ).toBe(true)
    expect(showProjectIoMessage).toHaveBeenCalledWith({
      key: 'importProjectFilesSkippedDuplicates',
      params: {
        count: 1,
        names: 'dup.v',
      },
    })
  })
})
