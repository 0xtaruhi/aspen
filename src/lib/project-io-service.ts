import type { ImportFilesResult } from '@/stores/project-file-operations'

import { projectStore } from '@/stores/project'
import { projectCanvasStore } from '@/stores/project-canvas'
import { recentProjectsStore } from '@/stores/recent-projects'

import { cloneImplementationSettings } from '@/lib/implementation-settings'
import { cloneProjectConstraintSnapshot } from '@/lib/project-constraints'
import { ASPEN_PROJECT_FILENAME, joinPath } from '@/lib/project-layout'
import {
  inspectProjectDirectory,
  loadProjectFromPath,
  readImportedSourceFiles,
  syncInMemoryImplementationCacheAfterSave,
  syncInMemorySynthesisCacheAfterSave,
  writeProjectBundle,
} from '@/lib/project-persistence'
import {
  getProjectIoErrorMessage,
  shouldForgetRecentProject,
  type ProjectIoMessageDescriptor,
  type ProjectIoServiceResult,
} from '@/lib/project-io-common'
import {
  cloneProjectCanvasDevices,
  cloneProjectImplementationCacheSnapshot,
  cloneProjectNodes,
  cloneProjectSynthesisCacheSnapshot,
} from '@/stores/project-model'

export type CreateProjectAtDirectoryOptions = {
  name: string
  template: 'empty' | 'blinky' | 'uart'
  parentDirectoryPath: string
  importPaths?: readonly string[]
}

export type PreparedCreateProjectDirectory = {
  parentDirectoryPath: string
  projectDirectoryPath: string
  projectName: string
}

type ProjectCreationRollbackState = {
  sessionId: number
  files: ReturnType<typeof cloneProjectNodes>
  activeFileId: string
  selectedNodeId: string
  renamingNodeId: string
  creatingNodeId: string
  selectionBeforeCreatingNodeId: string
  activeFileBeforeCreatingNodeId: string
  topFileId: string
  topModuleName: string
  targetDeviceId: typeof projectStore.targetDeviceId
  targetBoardId: typeof projectStore.targetBoardId
  pinConstraints: ReturnType<typeof cloneProjectConstraintSnapshot>
  implementationSettings: ReturnType<typeof cloneImplementationSettings>
  synthesisCache: ReturnType<typeof cloneProjectSynthesisCacheSnapshot>
  implementationCache: ReturnType<typeof cloneProjectImplementationCacheSnapshot>
  projectPath: string | null
  savedContentSnapshotJson: string
  savedFileSignatures: Record<string, string>
  canvasDevices: ReturnType<typeof cloneProjectCanvasDevices>
}

const IMPORT_SKIPPED_NAMES_LIMIT = 3

function summarizeSkippedImportNames(names: string[]) {
  const visibleNames = names
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, IMPORT_SKIPPED_NAMES_LIMIT)
    .join(', ')

  return names.length > IMPORT_SKIPPED_NAMES_LIMIT ? `${visibleNames}, ...` : visibleNames
}

function createImportWarningMessage(
  skippedNames: string[],
): ProjectIoMessageDescriptor | undefined {
  if (skippedNames.length === 0) {
    return undefined
  }

  return {
    key: 'importProjectFilesSkippedDuplicates',
    params: {
      count: skippedNames.length,
      names: summarizeSkippedImportNames(skippedNames),
    },
  }
}

function createImportResultSummary(result: ImportFilesResult) {
  return {
    createdCount: result.createdIds.length,
    skippedNames: [...result.skippedNames],
  }
}

function captureProjectCreationRollbackState(): ProjectCreationRollbackState {
  return {
    sessionId: projectStore.sessionId,
    files: cloneProjectNodes(projectStore.files),
    activeFileId: projectStore.activeFileId,
    selectedNodeId: projectStore.selectedNodeId,
    renamingNodeId: projectStore.renamingNodeId,
    creatingNodeId: projectStore.creatingNodeId,
    selectionBeforeCreatingNodeId: projectStore.selectionBeforeCreatingNodeId,
    activeFileBeforeCreatingNodeId: projectStore.activeFileBeforeCreatingNodeId,
    topFileId: projectStore.topFileId,
    topModuleName: projectStore.topModuleName,
    targetDeviceId: projectStore.targetDeviceId,
    targetBoardId: projectStore.targetBoardId,
    pinConstraints: cloneProjectConstraintSnapshot(projectStore.pinConstraints),
    implementationSettings: cloneImplementationSettings(projectStore.implementationSettings),
    synthesisCache: cloneProjectSynthesisCacheSnapshot(projectStore.synthesisCache),
    implementationCache: cloneProjectImplementationCacheSnapshot(projectStore.implementationCache),
    projectPath: projectStore.projectPath,
    savedContentSnapshotJson: projectStore.savedContentSnapshotJson,
    savedFileSignatures: { ...projectStore.savedFileSignatures },
    canvasDevices: cloneProjectCanvasDevices(projectCanvasStore.canvasDevices.value),
  }
}

function restoreProjectCreationRollbackState(state: ProjectCreationRollbackState) {
  projectStore.files = state.files
  projectStore.activeFileId = state.activeFileId
  projectStore.selectedNodeId = state.selectedNodeId
  projectStore.renamingNodeId = state.renamingNodeId
  projectStore.creatingNodeId = state.creatingNodeId
  projectStore.selectionBeforeCreatingNodeId = state.selectionBeforeCreatingNodeId
  projectStore.activeFileBeforeCreatingNodeId = state.activeFileBeforeCreatingNodeId
  projectStore.topFileId = state.topFileId
  projectStore.topModuleName = state.topModuleName
  projectStore.targetDeviceId = state.targetDeviceId
  projectStore.targetBoardId = state.targetBoardId
  projectStore.pinConstraints = state.pinConstraints
  projectStore.implementationSettings = state.implementationSettings
  projectStore.synthesisCache = state.synthesisCache
  projectStore.implementationCache = state.implementationCache
  projectStore.projectPath = state.projectPath
  projectStore.savedContentSnapshotJson = state.savedContentSnapshotJson
  projectStore.savedFileSignatures = { ...state.savedFileSignatures }
  projectCanvasStore.setCanvasDevices(state.canvasDevices)
  projectStore.cachedContentSnapshotJson = state.savedContentSnapshotJson
  projectStore.contentSnapshotCacheDirty = true
  projectStore.cachedCanvasRevision = projectCanvasStore.snapshotRevision.value
  projectStore.sessionId = state.sessionId
}

function restoreCreationFailureResult<T>(
  rollbackState: ProjectCreationRollbackState,
  result: Extract<ProjectIoServiceResult<T>, { kind: 'failure' }>,
) {
  restoreProjectCreationRollbackState(rollbackState)
  return result
}

export function validateCreateProjectAtDirectoryInput(
  options: CreateProjectAtDirectoryOptions,
): Extract<ProjectIoServiceResult<never>, { kind: 'failure' }> | null {
  const projectName = options.name.trim()
  const parentDirectoryPath = options.parentDirectoryPath.trim()

  if (!projectName) {
    return {
      kind: 'failure',
      reason: 'validation',
      message: {
        key: 'projectNameRequired',
      },
    }
  }

  if (!parentDirectoryPath) {
    return {
      kind: 'failure',
      reason: 'validation',
      message: {
        key: 'projectParentDirectoryRequired',
      },
    }
  }

  if (projectName === '.' || projectName === '..' || /[\\/]/.test(projectName)) {
    return {
      kind: 'failure',
      reason: 'validation',
      message: {
        key: 'projectNameInvalidForDirectory',
      },
    }
  }

  return null
}

export async function prepareCreateProjectDirectory(
  options: CreateProjectAtDirectoryOptions,
): Promise<ProjectIoServiceResult<PreparedCreateProjectDirectory>> {
  const projectName = options.name.trim()
  const parentDirectoryPath = options.parentDirectoryPath.trim()
  const projectDirectoryPath = joinPath(parentDirectoryPath, projectName)

  try {
    const inspection = await inspectProjectDirectory(projectDirectoryPath)
    if (inspection.exists) {
      if (inspection.metadata_exists) {
        return {
          kind: 'failure',
          reason: 'validation',
          message: {
            key: 'projectDirectoryAlreadyContainsProject',
          },
        }
      }

      if (inspection.visible_entry_count > 0) {
        return {
          kind: 'failure',
          reason: 'validation',
          message: {
            key: 'projectDirectoryMustBeEmpty',
          },
        }
      }
    }

    return {
      kind: 'success',
      value: {
        parentDirectoryPath,
        projectDirectoryPath,
        projectName,
      },
    }
  } catch (err) {
    return {
      kind: 'failure',
      reason: 'error',
      message: {
        key: 'createProjectFailed',
        params: {
          message: getProjectIoErrorMessage(err),
        },
      },
      error: err,
    }
  }
}

export function applyImportedFilesToProject(
  parentId: string,
  files: Array<{ name: string; content: string }>,
): ProjectIoServiceResult<{
  createdCount: number
  skippedNames: string[]
}> {
  const parent = projectStore.findNode(parentId)
  if (!parent || parent.type !== 'folder') {
    const error = new Error('Project root is missing.')
    return {
      kind: 'failure',
      reason: 'error',
      message: {
        key: 'importProjectFilesFailed',
        params: {
          message: getProjectIoErrorMessage(error),
        },
      },
      error,
    }
  }

  const result = projectStore.importFiles(parentId, files)
  return {
    kind: 'success',
    value: createImportResultSummary(result),
    message: createImportWarningMessage(result.skippedNames),
  }
}

export async function openProjectFromPath(path: string): Promise<ProjectIoServiceResult<boolean>> {
  try {
    return {
      kind: 'success',
      value: await loadProjectFromPath(path),
    }
  } catch (err) {
    return {
      kind: 'failure',
      reason: 'error',
      message: {
        key: 'openProjectFailed',
        params: {
          message: getProjectIoErrorMessage(err),
        },
      },
      error: err,
    }
  }
}

export async function openRecentProjectFromPath(
  path: string,
): Promise<ProjectIoServiceResult<boolean>> {
  try {
    return {
      kind: 'success',
      value: await loadProjectFromPath(path),
    }
  } catch (err) {
    if (shouldForgetRecentProject(err)) {
      recentProjectsStore.removeProject(path)
    }

    return {
      kind: 'failure',
      reason: 'error',
      message: {
        key: 'openProjectFailed',
        params: {
          message: getProjectIoErrorMessage(err),
        },
      },
      error: err,
    }
  }
}

export async function saveProjectBundleToPath(
  path: string,
  options: { preserveArtifacts: boolean },
): Promise<ProjectIoServiceResult<{ path: string }>> {
  try {
    await writeProjectBundle(path, {
      preserveArtifacts: options.preserveArtifacts,
    })
    syncInMemorySynthesisCacheAfterSave(options.preserveArtifacts)
    syncInMemoryImplementationCacheAfterSave(options.preserveArtifacts)
    projectStore.markSaved(path)
    recentProjectsStore.rememberProject(path, projectStore.toSnapshot().content.name)

    return {
      kind: 'success',
      value: { path },
    }
  } catch (err) {
    return {
      kind: 'failure',
      reason: 'error',
      message: {
        key: 'saveProjectFailed',
        params: {
          message: getProjectIoErrorMessage(err),
        },
      },
      error: err,
    }
  }
}

export async function finalizeCreateProjectDirectory(
  prepared: PreparedCreateProjectDirectory,
  options: Pick<CreateProjectAtDirectoryOptions, 'template' | 'importPaths'>,
): Promise<ProjectIoServiceResult<{ metadataPath: string }>> {
  const rollbackState = captureProjectCreationRollbackState()

  try {
    projectStore.createNewProject(prepared.projectName, options.template)

    let message: ProjectIoMessageDescriptor | undefined
    const importPaths = options.importPaths ?? []
    if (importPaths.length > 0) {
      const rootNode = projectStore.rootNode
      if (!rootNode) {
        const error = new Error('Project root is missing.')
        return restoreCreationFailureResult(rollbackState, {
          kind: 'failure',
          reason: 'error',
          message: {
            key: 'createProjectFailed',
            params: {
              message: getProjectIoErrorMessage(error),
            },
          },
          error,
        })
      }

      const importedFiles = await readImportedSourceFiles(importPaths)
      const importResult = applyImportedFilesToProject(rootNode.id, importedFiles)
      if (importResult.kind === 'failure') {
        return restoreCreationFailureResult(rollbackState, {
          kind: 'failure',
          reason: 'error',
          message: {
            key: 'createProjectFailed',
            params: {
              message: String(
                importResult.message.params?.message ?? 'Failed to import project files.',
              ),
            },
          },
          error: importResult.error,
        })
      }
      message = importResult.message
    }

    const metadataPath = joinPath(prepared.projectDirectoryPath, ASPEN_PROJECT_FILENAME)
    const saveResult = await saveProjectBundleToPath(metadataPath, {
      preserveArtifacts: false,
    })
    if (saveResult.kind === 'failure') {
      return restoreCreationFailureResult(rollbackState, {
        kind: 'failure',
        reason: 'error',
        message: {
          key: 'createProjectFailed',
          params: {
            message: String(saveResult.message.params?.message ?? 'Failed to save project.'),
          },
        },
        error: saveResult.error,
      })
    }

    return {
      kind: 'success',
      value: {
        metadataPath,
      },
      message,
    }
  } catch (err) {
    return restoreCreationFailureResult(rollbackState, {
      kind: 'failure',
      reason: 'error',
      message: {
        key: 'createProjectFailed',
        params: {
          message: getProjectIoErrorMessage(err),
        },
      },
      error: err,
    })
  }
}
