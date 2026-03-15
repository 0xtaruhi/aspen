import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

import { translate } from '@/lib/i18n'
import { projectStore } from '@/stores/project'

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

function getDefaultFilename() {
  const snapshot = projectStore.toSnapshot()
  return `${snapshot.name || 'project'}.aspen.json`
}

function serializeProject() {
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

    const content = await invoke<string>('read_project_file', { path: selected })
    const data = JSON.parse(content) as unknown
    projectStore.loadFromSnapshot(data, { projectPath: selected })
    return true
  } catch (err) {
    if (isTauriUnavailable(err)) {
      await openProjectInBrowserFallback()
      return true
    }

    window.alert(translate('openProjectFailed', { message: getErrorMessage(err) }))
    return false
  }
}

export async function saveProjectAs() {
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
  const serialized = serializeProject()

  try {
    if (projectStore.projectPath) {
      await invoke('write_project_file', {
        path: projectStore.projectPath,
        content: serialized,
      })
      projectStore.markSaved(projectStore.projectPath)
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
