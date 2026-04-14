import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

import { translate } from '@/lib/i18n'
import { ASPEN_PROJECT_FILENAME, getProjectMetadataPath } from '@/lib/project-layout'
import {
  getProjectIoErrorMessage,
  isProjectIoTauriUnavailable,
  showProjectIoMessage,
} from '@/lib/project-io-common'
import {
  applyImportedFilesToProject,
  finalizeCreateProjectDirectory,
  openProjectFromPath,
  openRecentProjectFromPath,
  prepareCreateProjectDirectory,
  saveProjectBundleToPath,
  validateCreateProjectAtDirectoryInput,
  type CreateProjectAtDirectoryOptions,
} from '@/lib/project-io-service'
import { hardwareStore } from '@/stores/hardware'
import { projectStore } from '@/stores/project'
import { requestProjectUnsavedChanges } from '@/stores/project-unsaved-changes'

type UnsavedProjectAction = 'open-project' | 'create-project' | 'close-project' | 'quit-application'

export const PROJECT_IMPORT_SOURCE_FILE_EXTENSIONS = ['v', 'sv', 'vh', 'txt', 'mem'] as const

function getCurrentProjectName() {
  return projectStore.files[0]?.name || translate('projectNameDefault')
}

function getUnsavedChangesActionLabel(action: UnsavedProjectAction) {
  switch (action) {
    case 'open-project':
      return translate('openingAnotherProjectAction')
    case 'create-project':
      return translate('creatingNewProjectAction')
    case 'close-project':
      return translate('closingCurrentProjectAction')
    case 'quit-application':
      return translate('quittingAspenAction')
  }
}

export async function resolveUnsavedProjectChanges(action: UnsavedProjectAction) {
  if (!projectStore.hasProject || !projectStore.hasUnsavedChanges) {
    return true
  }

  const decision = await requestProjectUnsavedChanges({
    title: translate('unsavedChanges'),
    description: translate('saveChangesBeforeAction', {
      name: getCurrentProjectName(),
      action: getUnsavedChangesActionLabel(action),
    }),
  })

  if (decision === 'save') {
    return await saveProject()
  }

  return decision === 'discard'
}

async function openProjectInBrowserFallback() {
  if (typeof document === 'undefined') {
    return
  }

  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,application/json'

  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) {
      return
    }

    try {
      const text = await file.text()
      const data = JSON.parse(text) as unknown
      if (
        typeof data === 'object' &&
        data !== null &&
        'layout' in data &&
        (data as { layout?: unknown }).layout === 'directory'
      ) {
        throw new Error('Directory-based Aspen projects require the desktop app to open.')
      }

      if (!(await resolveUnsavedProjectChanges('open-project'))) {
        return
      }

      projectStore.loadFromSnapshot(data)
    } catch (err) {
      showProjectIoMessage({
        key: 'openProjectFailed',
        params: {
          message: getProjectIoErrorMessage(err),
        },
      })
    }
  }

  input.click()
}

function saveProjectInBrowserFallback(serialized: string, filename: string) {
  if (typeof document === 'undefined') {
    return
  }

  const blob = new Blob([serialized], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

async function importFilesInBrowserFallback() {
  if (typeof document === 'undefined') {
    return false
  }

  const rootNode = projectStore.rootNode
  if (!rootNode) {
    return false
  }

  const input = document.createElement('input')
  input.type = 'file'
  input.multiple = true

  return await new Promise<boolean>((resolve) => {
    input.onchange = async () => {
      const files = Array.from(input.files ?? [])
      if (files.length === 0) {
        resolve(false)
        return
      }

      const importedFiles = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          content: await file.text(),
        })),
      )

      const result = applyImportedFilesToProject(rootNode.id, importedFiles)
      if (result.kind === 'failure') {
        showProjectIoMessage(result.message)
        resolve(false)
        return
      }

      if (result.message) {
        showProjectIoMessage(result.message)
      }

      resolve(true)
    }

    input.click()
  })
}

function getBrowserFallbackFilename() {
  return `${projectStore.toSnapshot().content.name || 'project'}.aspen.json`
}

function getDefaultMetadataPath() {
  if (projectStore.projectPath) {
    return getProjectMetadataPath(projectStore.projectPath)
  }

  return ASPEN_PROJECT_FILENAME
}

function serializeLegacyProject() {
  return JSON.stringify(projectStore.toSnapshot(), null, 2)
}

export async function openProject() {
  try {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: translate('aspenProject'), extensions: ['json'] }],
    })

    if (typeof selected !== 'string') {
      return false
    }

    if (!(await resolveUnsavedProjectChanges('open-project'))) {
      return false
    }

    const result = await openProjectFromPath(selected)
    if (result.kind === 'failure') {
      showProjectIoMessage(result.message)
      return false
    }

    return result.value
  } catch (err) {
    if (isProjectIoTauriUnavailable(err)) {
      await openProjectInBrowserFallback()
      return true
    }

    showProjectIoMessage({
      key: 'openProjectFailed',
      params: {
        message: getProjectIoErrorMessage(err),
      },
    })
    return false
  }
}

async function clearCurrentProject() {
  try {
    await hardwareStore.stopDataStream()
  } catch {
    // Closing the project should still proceed if the runtime is already idle.
  }

  try {
    await hardwareStore.clearCanvasDevices()
  } catch {
    // Project state is authoritative; runtime cleanup is best effort here.
  }

  projectStore.clearProject()
}

export async function closeProject(options: { promptForUnsavedChanges?: boolean } = {}) {
  if (!projectStore.hasProject) {
    return false
  }

  if (
    options.promptForUnsavedChanges !== false &&
    !(await resolveUnsavedProjectChanges('close-project'))
  ) {
    return false
  }

  await clearCurrentProject()
  return true
}

export async function openRecentProject(path: string) {
  if (!(await resolveUnsavedProjectChanges('open-project'))) {
    return false
  }

  const result = await openRecentProjectFromPath(path)
  if (result.kind === 'failure') {
    showProjectIoMessage(result.message)
    return false
  }

  return result.value
}

export async function importProjectFiles() {
  const rootNode = projectStore.rootNode
  if (!rootNode) {
    return false
  }

  try {
    const selected = await openDialog({
      multiple: true,
      filters: [
        {
          name: translate('sourceFiles'),
          extensions: [...PROJECT_IMPORT_SOURCE_FILE_EXTENSIONS],
        },
      ],
    })

    const selectedPaths =
      typeof selected === 'string' ? [selected] : Array.isArray(selected) ? selected : []

    if (selectedPaths.length === 0) {
      return false
    }

    const importedFiles = await Promise.all(
      selectedPaths.map(async (path) => ({
        name: path.replace(/\\/g, '/').split('/').pop() || path,
        content: await invoke<string>('read_project_file', { path }),
      })),
    )

    const result = applyImportedFilesToProject(rootNode.id, importedFiles)
    if (result.kind === 'failure') {
      showProjectIoMessage(result.message)
      return false
    }

    if (result.message) {
      showProjectIoMessage(result.message)
    }

    if (projectStore.projectPath) {
      try {
        await saveProjectToCurrentPath({ silent: true })
      } catch (err) {
        showProjectIoMessage({
          key: 'saveProjectFailed',
          params: {
            message: getProjectIoErrorMessage(err),
          },
        })
      }
    }

    return true
  } catch (err) {
    if (isProjectIoTauriUnavailable(err)) {
      return await importFilesInBrowserFallback()
    }

    showProjectIoMessage({
      key: 'importProjectFilesFailed',
      params: {
        message: getProjectIoErrorMessage(err),
      },
    })
    return false
  }
}

export async function saveProjectAs() {
  if (!projectStore.hasProject) {
    return false
  }

  const legacySerialized = serializeLegacyProject()
  const defaultPath = getDefaultMetadataPath()

  try {
    const selected = await saveDialog({
      defaultPath,
      filters: [{ name: translate('aspenProject'), extensions: ['json'] }],
    })

    if (!selected || Array.isArray(selected)) {
      return false
    }

    const preserveArtifacts = selected === projectStore.projectPath
    const result = await saveProjectBundleToPath(selected, {
      preserveArtifacts,
    })
    if (result.kind === 'failure') {
      if (isProjectIoTauriUnavailable(result.error)) {
        saveProjectInBrowserFallback(legacySerialized, getBrowserFallbackFilename())
        projectStore.markSaved(null)
        return true
      }

      showProjectIoMessage(result.message)
      return false
    }

    return true
  } catch (err) {
    if (isProjectIoTauriUnavailable(err)) {
      saveProjectInBrowserFallback(legacySerialized, getBrowserFallbackFilename())
      projectStore.markSaved(null)
      return true
    }

    showProjectIoMessage({
      key: 'saveProjectFailed',
      params: {
        message: getProjectIoErrorMessage(err),
      },
    })
    return false
  }
}

export async function createProjectAtDirectory(options: CreateProjectAtDirectoryOptions) {
  const validationFailure = validateCreateProjectAtDirectoryInput(options)
  if (validationFailure) {
    showProjectIoMessage(validationFailure.message)
    return false
  }

  const prepared = await prepareCreateProjectDirectory(options)
  if (prepared.kind === 'failure' && prepared.reason === 'validation') {
    showProjectIoMessage(prepared.message)
    return false
  }

  if (!(await resolveUnsavedProjectChanges('create-project'))) {
    return false
  }

  if (prepared.kind === 'failure') {
    if (isProjectIoTauriUnavailable(prepared.error)) {
      projectStore.createNewProject(options.name.trim(), options.template)
      return true
    }

    showProjectIoMessage(prepared.message)
    return false
  }

  const result = await finalizeCreateProjectDirectory(prepared.value, {
    template: options.template,
    importPaths: options.importPaths,
  })
  if (result.kind === 'failure') {
    if (isProjectIoTauriUnavailable(result.error)) {
      projectStore.createNewProject(options.name.trim(), options.template)
      return true
    }

    showProjectIoMessage(result.message)
    return false
  }

  if (result.message) {
    showProjectIoMessage(result.message)
  }

  return true
}

export async function saveProject() {
  if (!projectStore.hasProject) {
    return false
  }

  const legacySerialized = serializeLegacyProject()

  try {
    if (await saveProjectToCurrentPath({ silent: false })) {
      return true
    }

    return await saveProjectAs()
  } catch (err) {
    if (isProjectIoTauriUnavailable(err)) {
      saveProjectInBrowserFallback(legacySerialized, getBrowserFallbackFilename())
      projectStore.markSaved(null)
      return true
    }

    showProjectIoMessage({
      key: 'saveProjectFailed',
      params: {
        message: getProjectIoErrorMessage(err),
      },
    })
    return false
  }
}

export async function saveProjectToCurrentPath(options: { silent?: boolean } = {}) {
  if (!projectStore.hasProject || !projectStore.projectPath) {
    return false
  }

  try {
    const result = await saveProjectBundleToPath(projectStore.projectPath, {
      preserveArtifacts: true,
    })
    if (result.kind === 'failure') {
      if (isProjectIoTauriUnavailable(result.error)) {
        return false
      }

      if (!options.silent) {
        showProjectIoMessage(result.message)
      }

      // Re-throw saveProjectBundleToPath failures so parent save flows like
      // saveProject can decide whether to surface or recover from them.
      throw result.error ?? new Error(translate(result.message.key, result.message.params))
    }

    return true
  } catch (err) {
    if (isProjectIoTauriUnavailable(err)) {
      return false
    }

    // Non-Tauri failures are intentionally propagated after local handling so
    // callers such as saveProject can apply their own error policy.
    throw err
  }
}
