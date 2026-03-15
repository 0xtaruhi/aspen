import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

import { translate } from '@/lib/i18n'
import { projectStore } from '@/stores/project'
import { recentProjectsStore } from '@/stores/recent-projects'

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

function getDefaultFilename() {
  const snapshot = projectStore.toSnapshot()
  return `${snapshot.name || 'project'}.aspen.json`
}

function serializeProject() {
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

async function loadProjectFromPath(path: string) {
  const content = await invoke<string>('read_project_file', { path })
  const data = JSON.parse(content) as unknown
  projectStore.loadFromSnapshot(data, { projectPath: path })
  recentProjectsStore.rememberProject(path, projectStore.toSnapshot().name)
  return true
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

export async function openRecentProject(path: string) {
  try {
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

  const serialized = serializeProject()
  const defaultPath = projectStore.projectPath ?? getDefaultFilename()

  try {
    const selected = await saveDialog({
      defaultPath,
      filters: [{ name: translate('aspenProject'), extensions: ['json'] }],
    })

    if (!selected || Array.isArray(selected)) {
      return false
    }

    await invoke('write_project_file', { path: selected, content: serialized })
    projectStore.markSaved(selected)
    recentProjectsStore.rememberProject(selected, projectStore.toSnapshot().name)
    return true
  } catch (err) {
    if (isTauriUnavailable(err)) {
      saveProjectInBrowserFallback(serialized, getDefaultFilename())
      projectStore.markSaved(null)
      return true
    }

    window.alert(translate('saveProjectFailed', { message: getErrorMessage(err) }))
    return false
  }
}

export async function saveProject() {
  if (!projectStore.hasProject) {
    return false
  }

  const serialized = serializeProject()

  try {
    if (await saveProjectToCurrentPath({ silent: false })) {
      return true
    }

    const saved = await saveProjectAs()
    return saved
  } catch (err) {
    if (isTauriUnavailable(err)) {
      saveProjectInBrowserFallback(serialized, getDefaultFilename())
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

  const serialized = serializeProject()

  try {
    await invoke('write_project_file', {
      path: projectStore.projectPath,
      content: serialized,
    })
    projectStore.markSaved(projectStore.projectPath)
    recentProjectsStore.rememberProject(projectStore.projectPath, projectStore.toSnapshot().name)
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
