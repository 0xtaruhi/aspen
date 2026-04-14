import { invoke } from '@tauri-apps/api/core'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'

import { getProjectOutputDirectory } from '@/lib/project-layout'
import {
  getProjectIoErrorMessage,
  isProjectIoTauriUnavailable,
  showProjectIoMessage,
} from '@/lib/project-io-common'
import { projectStore } from '@/stores/project'
import { translate } from './i18n'

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
  const projectName = projectStore.toSnapshot().content.name || 'project'
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
    if (isProjectIoTauriUnavailable(err)) {
      createBrowserDownload(content, defaultConstraintPath().split('/').pop() || 'constraints.xml')
      return defaultConstraintPath()
    }

    showProjectIoMessage({
      key: 'saveProjectFailed',
      params: {
        message: getProjectIoErrorMessage(err),
      },
    })
    return null
  }
}
