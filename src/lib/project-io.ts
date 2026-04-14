import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

import { translate } from '@/lib/i18n'
import {
  inspectProjectDirectory,
  loadProjectFromPath,
  readImportedSourceFiles,
  syncInMemoryImplementationCacheAfterSave,
  syncInMemorySynthesisCacheAfterSave,
  writeProjectBundle,
} from '@/lib/project-persistence'
import { ASPEN_PROJECT_FILENAME, getProjectMetadataPath, joinPath } from '@/lib/project-layout'
import { hardwareStore } from '@/stores/hardware'
import { projectStore } from '@/stores/project'
import { requestProjectUnsavedChanges } from '@/stores/project-unsaved-changes'
import { recentProjectsStore } from '@/stores/recent-projects'

type UnsavedProjectAction = 'open-project' | 'create-project' | 'close-project' | 'quit-application'

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isTauriUnavailable(err: unknown): boolean {
  const message = getErrorMessage(err)
  return (
    message.includes('__TAURI_INTERNALS__') ||
    message.includes('window.__TAURI_INTERNALS__') ||
    message.includes('plugin')
  )
}

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
      window.alert(translate('openProjectFailed', { message: getErrorMessage(err) }))
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

      projectStore.importFiles(rootNode.id, importedFiles)
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

function shouldForgetRecentProject(err: unknown) {
  const message = getErrorMessage(err).toLowerCase()
  return (
    message.includes('no such file') ||
    message.includes('not found') ||
    message.includes('cannot find the path')
  )
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

    return await loadProjectFromPath(selected)
  } catch (err) {
    if (isTauriUnavailable(err)) {
      await openProjectInBrowserFallback()
      return true
    }

    window.alert(translate('openProjectFailed', { message: getErrorMessage(err) }))
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
  try {
    if (!(await resolveUnsavedProjectChanges('open-project'))) {
      return false
    }

    return await loadProjectFromPath(path)
  } catch (err) {
    if (shouldForgetRecentProject(err)) {
      recentProjectsStore.removeProject(path)
    }

    window.alert(translate('openProjectFailed', { message: getErrorMessage(err) }))
    return false
  }
}

export async function importProjectFiles() {
  const rootNode = projectStore.rootNode
  if (!rootNode) {
    return false
  }

  try {
    const selected = await openDialog({
      multiple: true,
      filters: [{ name: translate('sourceFiles'), extensions: ['v', 'sv', 'vh', 'txt'] }],
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

    projectStore.importFiles(rootNode.id, importedFiles)

    if (projectStore.projectPath) {
      await saveProjectToCurrentPath({ silent: true })
    }

    return true
  } catch (err) {
    if (isTauriUnavailable(err)) {
      return await importFilesInBrowserFallback()
    }

    window.alert(translate('openProjectFailed', { message: getErrorMessage(err) }))
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
    await writeProjectBundle(selected, {
      preserveArtifacts,
    })
    syncInMemorySynthesisCacheAfterSave(preserveArtifacts)
    syncInMemoryImplementationCacheAfterSave(preserveArtifacts)
    projectStore.markSaved(selected)
    recentProjectsStore.rememberProject(selected, projectStore.toSnapshot().content.name)
    return true
  } catch (err) {
    if (isTauriUnavailable(err)) {
      saveProjectInBrowserFallback(legacySerialized, getBrowserFallbackFilename())
      projectStore.markSaved(null)
      return true
    }

    window.alert(translate('saveProjectFailed', { message: getErrorMessage(err) }))
    return false
  }
}

export async function createProjectAtDirectory(options: {
  name: string
  template: 'empty' | 'blinky' | 'uart'
  parentDirectoryPath: string
  importPaths?: readonly string[]
}) {
  const projectName = options.name.trim()
  const parentDirectoryPath = options.parentDirectoryPath.trim()

  if (!projectName) {
    window.alert(translate('projectNameRequired'))
    return false
  }

  if (!parentDirectoryPath) {
    window.alert(translate('projectParentDirectoryRequired'))
    return false
  }

  if (/[\\/]/.test(projectName)) {
    window.alert(translate('projectNameInvalidForDirectory'))
    return false
  }

  const projectDirectoryPath = joinPath(parentDirectoryPath, projectName)

  try {
    const inspection = await inspectProjectDirectory(projectDirectoryPath)
    if (inspection.exists) {
      if (inspection.metadata_exists) {
        window.alert(translate('projectDirectoryAlreadyContainsProject'))
        return false
      }

      if (inspection.visible_entry_count > 0) {
        window.alert(translate('projectDirectoryMustBeEmpty'))
        return false
      }
    }

    if (!(await resolveUnsavedProjectChanges('create-project'))) {
      return false
    }

    projectStore.createNewProject(projectName, options.template)

    const importPaths = options.importPaths ?? []
    if (importPaths.length > 0) {
      const rootNode = projectStore.rootNode
      if (!rootNode) {
        throw new Error('Project root is missing')
      }

      const importedFiles = await readImportedSourceFiles(importPaths)
      projectStore.importFiles(rootNode.id, importedFiles)
    }

    const metadataPath = joinPath(projectDirectoryPath, ASPEN_PROJECT_FILENAME)
    await writeProjectBundle(metadataPath, { preserveArtifacts: false })
    syncInMemorySynthesisCacheAfterSave(false)
    syncInMemoryImplementationCacheAfterSave(false)
    projectStore.markSaved(metadataPath)
    recentProjectsStore.rememberProject(metadataPath, projectStore.toSnapshot().content.name)
    return true
  } catch (err) {
    if (isTauriUnavailable(err)) {
      if (!(await resolveUnsavedProjectChanges('create-project'))) {
        return false
      }

      projectStore.createNewProject(options.name, options.template)
      return true
    }

    window.alert(translate('createProjectFailed', { message: getErrorMessage(err) }))
    return false
  }
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
    if (isTauriUnavailable(err)) {
      saveProjectInBrowserFallback(legacySerialized, getBrowserFallbackFilename())
      projectStore.markSaved(null)
      return true
    }

    window.alert(translate('saveProjectFailed', { message: getErrorMessage(err) }))
    return false
  }
}

export async function saveProjectToCurrentPath(options: { silent?: boolean } = {}) {
  if (!projectStore.hasProject || !projectStore.projectPath) {
    return false
  }

  try {
    await writeProjectBundle(projectStore.projectPath, {
      preserveArtifacts: true,
    })
    projectStore.markSaved(projectStore.projectPath)
    recentProjectsStore.rememberProject(
      projectStore.projectPath,
      projectStore.toSnapshot().content.name,
    )
    return true
  } catch (err) {
    if (isTauriUnavailable(err)) {
      return false
    }

    if (!options.silent) {
      window.alert(translate('saveProjectFailed', { message: getErrorMessage(err) }))
    }

    throw err
  }
}
