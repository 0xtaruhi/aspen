import type { ProjectNode, ProjectSnapshot, ProjectSynthesisCacheSnapshot } from '@/stores/project'

import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

import { translate } from '@/lib/i18n'
import {
  ASPEN_PROJECT_FILENAME,
  getProjectMetadataPath,
  getProjectSourcesDirectory,
  joinPath,
} from '@/lib/project-layout'
import { projectStore } from '@/stores/project'
import { recentProjectsStore } from '@/stores/recent-projects'

type ProjectMetadataNode = Omit<ProjectNode, 'content'> & {
  children?: ProjectMetadataNode[]
}

type ProjectMetadataSnapshot = Omit<ProjectSnapshot, 'version' | 'files'> & {
  version: 2
  layout: 'directory'
  files: ProjectMetadataNode[]
}

type ProjectSourceFileWriteRequest = {
  relative_path: string
  content: string
}

type ProjectDirectoryInspection = {
  exists: boolean
  metadata_exists: boolean
  visible_entry_count: number
}

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProjectMetadataSnapshot(value: unknown): value is ProjectMetadataSnapshot {
  return (
    isRecord(value) &&
    value.version === 2 &&
    value.layout === 'directory' &&
    Array.isArray(value.files)
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
      if (isProjectMetadataSnapshot(data)) {
        throw new Error('Directory-based Aspen projects require the desktop app to open.')
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
  return `${projectStore.toSnapshot().name || 'project'}.aspen.json`
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

function clonePersistedSynthesisCache(
  snapshot: ProjectSynthesisCacheSnapshot | null,
  preserveArtifacts: boolean,
) {
  if (!snapshot) {
    return null
  }

  const cloned = JSON.parse(JSON.stringify(snapshot)) as ProjectSynthesisCacheSnapshot
  if (!preserveArtifacts && cloned.report.artifacts) {
    cloned.report.artifacts = null
  }

  return cloned
}

function stripNodeContents(node: ProjectNode): ProjectMetadataNode {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    isOpen: node.isOpen,
    children: node.children?.map(stripNodeContents),
  }
}

function createProjectMetadataSnapshot(options: { preserveArtifacts: boolean }) {
  const snapshot = projectStore.toSnapshot()

  return {
    version: 2,
    layout: 'directory',
    name: snapshot.name,
    files: snapshot.files.map(stripNodeContents),
    activeFileId: snapshot.activeFileId,
    topFileId: snapshot.topFileId,
    topModuleName: snapshot.topModuleName,
    targetDeviceId: snapshot.targetDeviceId,
    targetBoardId: snapshot.targetBoardId,
    pinConstraints: snapshot.pinConstraints,
    implementationSettings: snapshot.implementationSettings,
    synthesisCache: clonePersistedSynthesisCache(
      snapshot.synthesisCache,
      options.preserveArtifacts,
    ),
  } satisfies ProjectMetadataSnapshot
}

function shouldForgetRecentProject(err: unknown) {
  const message = getErrorMessage(err).toLowerCase()
  return (
    message.includes('no such file') ||
    message.includes('not found') ||
    message.includes('cannot find the path')
  )
}

function getPersistedSourceNodes() {
  return projectStore.rootNode?.children ?? projectStore.files
}

function collectProjectSourceFiles(
  nodes: readonly ProjectNode[],
  parentSegments: string[] = [],
): ProjectSourceFileWriteRequest[] {
  const sourceFiles: ProjectSourceFileWriteRequest[] = []

  for (const node of nodes) {
    const nextSegments = [...parentSegments, node.name]
    if (node.type === 'file') {
      sourceFiles.push({
        relative_path: nextSegments.join('/'),
        content: node.content ?? '',
      })
      continue
    }

    if (node.children) {
      sourceFiles.push(...collectProjectSourceFiles(node.children, nextSegments))
    }
  }

  return sourceFiles
}

async function hydrateNodesFromDisk(
  nodes: readonly ProjectMetadataNode[],
  basePath: string,
): Promise<ProjectNode[]> {
  return await Promise.all(
    nodes.map(async (node) => {
      if (node.type === 'file') {
        return {
          ...node,
          content: await invoke<string>('read_project_file', {
            path: joinPath(basePath, node.name),
          }),
        } satisfies ProjectNode
      }

      return {
        ...node,
        children: await hydrateNodesFromDisk(node.children ?? [], joinPath(basePath, node.name)),
      } satisfies ProjectNode
    }),
  )
}

async function hydrateProjectSnapshot(
  metadataPath: string,
  metadata: ProjectMetadataSnapshot,
): Promise<ProjectSnapshot> {
  const sourcesDirectory = getProjectSourcesDirectory(metadataPath)
  if (!sourcesDirectory) {
    throw new Error('Project source directory could not be resolved.')
  }

  const hydratedFiles =
    metadata.files.length === 1 && metadata.files[0]?.type === 'folder'
      ? [
          {
            ...metadata.files[0],
            children: await hydrateNodesFromDisk(
              metadata.files[0].children ?? [],
              sourcesDirectory,
            ),
          } satisfies ProjectNode,
        ]
      : await hydrateNodesFromDisk(metadata.files, sourcesDirectory)

  return {
    version: 1,
    name: metadata.name,
    files: hydratedFiles,
    activeFileId: metadata.activeFileId,
    topFileId: metadata.topFileId,
    topModuleName: metadata.topModuleName,
    targetDeviceId: metadata.targetDeviceId,
    targetBoardId: metadata.targetBoardId,
    pinConstraints: metadata.pinConstraints,
    implementationSettings: metadata.implementationSettings,
    synthesisCache: metadata.synthesisCache,
  }
}

async function loadProjectFromPath(path: string) {
  const content = await invoke<string>('read_project_file', { path })
  const data = JSON.parse(content) as unknown

  if (isProjectMetadataSnapshot(data)) {
    const hydrated = await hydrateProjectSnapshot(path, data)
    projectStore.loadFromSnapshot(hydrated, { projectPath: path })
  } else {
    projectStore.loadFromSnapshot(data, { projectPath: path })
  }

  recentProjectsStore.rememberProject(path, projectStore.toSnapshot().name)
  return true
}

async function writeProjectBundle(path: string, options: { preserveArtifacts: boolean }) {
  const metadata = JSON.stringify(createProjectMetadataSnapshot(options), null, 2)
  const sourceFiles = collectProjectSourceFiles(getPersistedSourceNodes())

  await invoke('write_project_bundle', {
    metadataPath: path,
    metadataContent: metadata,
    sourceFiles,
  })
}

function syncInMemorySynthesisCacheAfterSave(preserveArtifacts: boolean) {
  if (preserveArtifacts) {
    return
  }

  projectStore.setSynthesisCache(clonePersistedSynthesisCache(projectStore.synthesisCache, false))
}

async function readImportedSourceFiles(paths: readonly string[]) {
  return await Promise.all(
    paths.map(async (path) => ({
      name: path.replace(/\\/g, '/').split('/').pop() || path,
      content: await invoke<string>('read_project_file', { path }),
    })),
  )
}

async function inspectProjectDirectory(path: string) {
  return await invoke<ProjectDirectoryInspection>('inspect_project_directory', { path })
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
    projectStore.markSaved(selected)
    recentProjectsStore.rememberProject(selected, projectStore.toSnapshot().name)
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
    projectStore.markSaved(metadataPath)
    recentProjectsStore.rememberProject(metadataPath, projectStore.toSnapshot().name)
    return true
  } catch (err) {
    if (isTauriUnavailable(err)) {
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
