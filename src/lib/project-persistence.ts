import type { ProjectNode, ProjectSnapshot, ProjectSynthesisCacheSnapshot } from '@/stores/project'

import { invoke } from '@tauri-apps/api/core'

import {
  createSynthesisArtifactManifest,
  parseSynthesisArtifactManifest,
} from '@/lib/flow-artifact-manifest'
import {
  getProjectSourcesDirectory,
  getProjectSynthesisManifestPath,
  joinPath,
} from '@/lib/project-layout'
import { projectStore } from '@/stores/project'
import { recentProjectsStore } from '@/stores/recent-projects'
import { hardwareStore } from '@/stores/hardware'

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

export type ProjectDirectoryInspection = {
  exists: boolean
  metadata_exists: boolean
  visible_entry_count: number
}

function getErrorMessage(err: unknown): string {
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

function shouldIgnorePersistenceError(err: unknown) {
  const message = getErrorMessage(err).toLowerCase()
  return (
    isTauriUnavailable(err) ||
    message.includes('no such file') ||
    message.includes('not found') ||
    message.includes('cannot find the path')
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
    canvasDevices: snapshot.canvasDevices,
  } satisfies ProjectMetadataSnapshot
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
    canvasDevices: Array.isArray(metadata.canvasDevices) ? metadata.canvasDevices : [],
  }
}

async function hydratePersistedSynthesisManifest(metadataPath: string) {
  const manifestPath = getProjectSynthesisManifestPath(metadataPath)
  if (!manifestPath) {
    return
  }

  try {
    const raw = await invoke<string>('read_project_file', { path: manifestPath })
    const manifest = parseSynthesisArtifactManifest(JSON.parse(raw) as unknown)
    if (!manifest) {
      return
    }

    if (
      projectStore.synthesisCache &&
      projectStore.synthesisCache.signature !== manifest.signature
    ) {
      return
    }

    projectStore.setSynthesisCache({
      version: 1,
      signature: manifest.signature,
      report: manifest.report,
    })
  } catch (err) {
    if (shouldIgnorePersistenceError(err)) {
      return
    }
  }
}

async function writePersistedSynthesisManifest(
  metadataPath: string,
  options: { preserveArtifacts: boolean },
) {
  const manifestPath = getProjectSynthesisManifestPath(metadataPath)
  if (!manifestPath) {
    return
  }

  const manifest = options.preserveArtifacts
    ? createSynthesisArtifactManifest(projectStore.synthesisCache)
    : null

  await invoke('write_project_file', {
    path: manifestPath,
    content: JSON.stringify(manifest, null, 2),
  })
}

export async function loadProjectFromPath(path: string) {
  const content = await invoke<string>('read_project_file', { path })
  const data = JSON.parse(content) as unknown

  if (isProjectMetadataSnapshot(data)) {
    const hydrated = await hydrateProjectSnapshot(path, data)
    projectStore.loadFromSnapshot(hydrated, { projectPath: path })
  } else {
    projectStore.loadFromSnapshot(data, { projectPath: path })
  }

  await hydratePersistedSynthesisManifest(path)
  await hardwareStore.replaceCanvasDevices(projectStore.toSnapshot().canvasDevices)

  recentProjectsStore.rememberProject(path, projectStore.toSnapshot().name)
  return true
}

export async function writeProjectBundle(path: string, options: { preserveArtifacts: boolean }) {
  const metadata = JSON.stringify(createProjectMetadataSnapshot(options), null, 2)
  const sourceFiles = collectProjectSourceFiles(getPersistedSourceNodes())

  await invoke('write_project_bundle', {
    metadataPath: path,
    metadataContent: metadata,
    sourceFiles,
  })
  await writePersistedSynthesisManifest(path, options)
}

export function syncInMemorySynthesisCacheAfterSave(preserveArtifacts: boolean) {
  if (preserveArtifacts) {
    return
  }

  projectStore.setSynthesisCache(clonePersistedSynthesisCache(projectStore.synthesisCache, false))
}

export async function readImportedSourceFiles(paths: readonly string[]) {
  return await Promise.all(
    paths.map(async (path) => ({
      name: path.replace(/\\/g, '/').split('/').pop() || path,
      content: await invoke<string>('read_project_file', { path }),
    })),
  )
}

export async function inspectProjectDirectory(path: string) {
  return await invoke<ProjectDirectoryInspection>('inspect_project_directory', { path })
}
