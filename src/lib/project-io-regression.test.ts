import { beforeEach, describe, expect, it, vi } from 'vitest'

function createProjectIoServiceMocks(overrides: Record<string, unknown> = {}) {
  return {
    applyImportedFilesToProject: vi.fn(),
    finalizeCreateProjectDirectory: vi.fn(),
    openProjectFromPath: vi.fn(),
    openRecentProjectFromPath: vi.fn(),
    prepareCreateProjectDirectory: vi.fn(),
    saveProjectBundleToPath: vi.fn(),
    validateCreateProjectAtDirectoryInput: vi.fn(),
    ...overrides,
  }
}

function createProjectStoreMock(overrides: Record<string, unknown> = {}) {
  return {
    files: [],
    hasProject: false,
    hasUnsavedChanges: false,
    projectPath: null,
    toSnapshot: vi.fn(() => ({
      content: {
        name: 'DemoProject',
      },
    })),
    markSaved: vi.fn(),
    ...overrides,
  }
}

function setupProjectIoMocks(
  options: {
    invoke?: ReturnType<typeof vi.fn>
    openDialog?: ReturnType<typeof vi.fn>
    saveDialog?: ReturnType<typeof vi.fn>
    service?: Record<string, unknown>
    projectStore?: Record<string, unknown>
  } = {},
) {
  const showProjectIoMessage = vi.fn()
  const invoke = options.invoke ?? vi.fn()
  const openDialog = options.openDialog ?? vi.fn()
  const saveDialog = options.saveDialog ?? vi.fn()
  const service = createProjectIoServiceMocks(options.service)
  const projectStore = createProjectStoreMock(options.projectStore)

  vi.doMock('@tauri-apps/api/core', () => ({
    invoke,
  }))
  vi.doMock('@tauri-apps/plugin-dialog', () => ({
    open: openDialog,
    save: saveDialog,
  }))
  vi.doMock('@/lib/i18n', () => ({
    translate: vi.fn((key: string) => key),
  }))
  vi.doMock('@/lib/project-layout', () => ({
    ASPEN_PROJECT_FILENAME: 'aspen.project.json',
    getProjectMetadataPath: vi.fn((path: string) => path),
  }))
  vi.doMock('@/lib/project-io-common', () => ({
    getProjectIoErrorMessage: vi.fn((err: unknown) =>
      err instanceof Error ? err.message : String(err),
    ),
    isProjectIoTauriUnavailable: vi.fn(() => false),
    showProjectIoMessage,
  }))
  vi.doMock('@/lib/project-io-service', () => service)
  vi.doMock('@/stores/hardware', () => ({
    hardwareStore: {},
  }))
  vi.doMock('@/stores/project', () => ({
    projectStore,
  }))
  vi.doMock('@/stores/project-unsaved-changes', () => ({
    requestProjectUnsavedChanges: vi.fn(),
  }))

  return {
    invoke,
    openDialog,
    projectStore,
    saveDialog,
    service,
    showProjectIoMessage,
  }
}

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
    const { showProjectIoMessage } = setupProjectIoMocks({
      invoke: vi.fn().mockResolvedValue('module duplicate; endmodule'),
      openDialog: vi.fn().mockResolvedValue(['/tmp/dup.v']),
      service: {
        applyImportedFilesToProject,
      },
      projectStore: {
        hasProject: true,
        rootNode: {
          id: 'root',
          type: 'folder',
        },
      },
    })

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
    const { showProjectIoMessage } = setupProjectIoMocks({
      service: {
        finalizeCreateProjectDirectory,
        prepareCreateProjectDirectory: vi.fn().mockResolvedValue({
          kind: 'success',
          value: {
            parentDirectoryPath: '/tmp',
            projectDirectoryPath: '/tmp/Demo',
            projectName: 'Demo',
          },
        }),
        validateCreateProjectAtDirectoryInput: vi.fn(() => null),
      },
    })

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

  it('surfaces save failures only once when saving the current project path fails', async () => {
    const saveProjectBundleToPath = vi.fn().mockResolvedValue({
      kind: 'failure',
      reason: 'error',
      message: {
        key: 'saveProjectFailed',
        params: {
          message: 'write failed',
        },
      },
      error: new Error('write failed'),
    })
    const { showProjectIoMessage } = setupProjectIoMocks({
      service: {
        saveProjectBundleToPath,
      },
      projectStore: {
        hasProject: true,
        projectPath: '/tmp/demo/aspen.project.json',
      },
    })

    const { saveProject } = await import('./project-io')

    expect(await saveProject()).toBe(false)
    expect(showProjectIoMessage).toHaveBeenCalledTimes(1)
    expect(showProjectIoMessage).toHaveBeenCalledWith({
      key: 'saveProjectFailed',
      params: {
        message: 'write failed',
      },
    })
  })

  it('shows save warnings returned after a successful current-path save', async () => {
    const saveProjectBundleToPath = vi.fn().mockResolvedValue({
      kind: 'success',
      value: {
        path: '/tmp/demo/aspen.project.json',
      },
      message: {
        key: 'saveProjectCompletedWithWarnings',
        params: {
          message: 'cache sync failed',
        },
      },
    })
    const { showProjectIoMessage } = setupProjectIoMocks({
      service: {
        saveProjectBundleToPath,
      },
      projectStore: {
        hasProject: true,
        projectPath: '/tmp/demo/aspen.project.json',
      },
    })

    const { saveProjectToCurrentPath } = await import('./project-io')

    expect(await saveProjectToCurrentPath()).toBe(true)
    expect(showProjectIoMessage).toHaveBeenCalledWith({
      key: 'saveProjectCompletedWithWarnings',
      params: {
        message: 'cache sync failed',
      },
    })
  })
})
