import { invoke } from '@tauri-apps/api/core'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'

import { getProjectOutputDirectory } from '@/lib/project-layout'
import { projectStore } from '@/stores/project'
import { translate } from './i18n'

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function isTauriUnavailable(err: unknown) {
  const message = getErrorMessage(err)
  return (
    message.includes('__TAURI_INTERNALS__') ||
    message.includes('window.__TAURI_INTERNALS__') ||
    message.includes('plugin')
  )
}

function createBrowserDownload(content: string, filename: string) {
  if (typeof document === 'undefined') {
    return
  }

  const blob = new Blob([content], { type: 'application/xml' })
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

function defaultConstraintPath() {
  const projectName = projectStore.toSnapshot().name || 'project'
  const filename = `${projectName}_cons.xml`
  const projectDirectory = getProjectOutputDirectory(projectStore.projectPath)
  return projectDirectory ? `${projectDirectory}/${filename}` : filename
}

export async function exportConstraintXml(content: string) {
  try {
    const selected = await saveDialog({
      defaultPath: defaultConstraintPath(),
      filters: [{ name: translate('constraintFile'), extensions: ['xml'] }],
    })

    if (!selected || Array.isArray(selected)) {
      return null
    }

    await invoke('write_project_file', {
      path: selected,
      content,
    })

    return selected
  } catch (err) {
    if (isTauriUnavailable(err)) {
      createBrowserDownload(content, defaultConstraintPath().split('/').pop() || 'constraints.xml')
      return defaultConstraintPath()
    }

    window.alert(translate('saveProjectFailed', { message: getErrorMessage(err) }))
    return null
  }
}
