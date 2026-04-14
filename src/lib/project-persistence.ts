import type {
  ProjectContentSnapshot,
  ProjectImplementationCacheSnapshot,
  ProjectNode,
  ProjectSnapshot,
  ProjectWorkspaceViewSnapshot,
  ProjectSynthesisCacheSnapshot,
} from '@/stores/project'

import { composeProjectSnapshot, splitProjectSnapshot } from '@/stores/project-model'
import { buildLoadedProjectSession } from '@/stores/project-session'
import { invoke } from '@tauri-apps/api/core'

import {
  createImplementationArtifactManifest,
  createSynthesisArtifactManifest,
  parseImplementationArtifactManifest,
  parseSynthesisArtifactManifest,
} from '@/lib/flow-artifact-manifest'
import {
  getProjectImplementationManifestPath,
  getProjectSourcesDirectory,
  getProjectSynthesisManifestPath,
  joinPath,
} from '@/lib/project-layout'
import {
  isMissingProjectPersistencePath,
  isProjectPersistenceTauriUnavailable,
} from './project-persistence-errors'
import { projectStore } from '@/stores/project'
import { recentProjectsStore } from '@/stores/recent-projects'
import { hardwareStore } from '@/stores/hardware'

type ProjectMetadataNode = Omit<ProjectNode, 'content'> & {
  children?: ProjectMetadataNode[]
}

type ProjectMetadataContentSnapshot = Omit<ProjectContentSnapshot, 'files'> & {
  files: ProjectMetadataNode[]
}

type ProjectMetadataSnapshot = {
  version: 3
  layout: 'directory'
  content: ProjectMetadataContentSnapshot
  workspaceView: ProjectWorkspaceViewSnapshot
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

function shouldIgnorePersistenceError(err: unknown) {
  return isProjectPersistenceTauriUnavailable(err) || isMissingProjectPersistencePath(err)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProjectMetadataSnapshot(value: unknown): value is ProjectMetadataSnapshot {
  return (
    isRecord(value) &&
    value.version === 3 &&
    value.layout === 'directory' &&
    isRecord(value.content) &&
    Array.isArray(value.content.files) &&
    isRecord(value.workspaceView) &&
    typeof value.workspaceView.activeFileId === 'string'
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

function clonePersistedImplementationCache(
  snapshot: ProjectImplementationCacheSnapshot | null,
  preserveArtifacts: boolean,
) {
  if (!snapshot) {
    return null
  }

  if (!preserveArtifacts) {
    return null
  }

  return JSON.parse(JSON.stringify(snapshot)) as ProjectImplementationCacheSnapshot
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
  const { contentSnapshot, workspaceViewSnapshot } = splitProjectSnapshot(snapshot)
  const { files, synthesisCache, implementationCache, ...persistedContentSnapshot } =
    contentSnapshot

  return {
    version: 3,
    layout: 'directory',
    content: {
      ...persistedContentSnapshot,
      files: files.map(stripNodeContents),
      synthesisCache: clonePersistedSynthesisCache(synthesisCache, options.preserveArtifacts),
      implementationCache: clonePersistedImplementationCache(
        implementationCache,
        options.preserveArtifacts,
      ),
    },
    workspaceView: workspaceViewSnapshot,
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
    metadata.content.files.length === 1 && metadata.content.files[0]?.type === 'folder'
      ? [
          {
            ...metadata.content.files[0],
            children: await hydrateNodesFromDisk(
              metadata.content.files[0].children ?? [],
              sourcesDirectory,
            ),
          } satisfies ProjectNode,
        ]
      : await hydrateNodesFromDisk(metadata.content.files, sourcesDirectory)

  const contentSnapshot: ProjectContentSnapshot = {
    name: metadata.content.name,
    files: hydratedFiles,
    topFileId: metadata.content.topFileId,
    topModuleName: metadata.content.topModuleName,
    targetDeviceId: metadata.content.targetDeviceId,
    targetBoardId: metadata.content.targetBoardId,
    pinConstraints: metadata.content.pinConstraints,
    implementationSettings: metadata.content.implementationSettings,
    synthesisCache: metadata.content.synthesisCache,
    implementationCache: metadata.content.implementationCache ?? null,
    canvasDevices: Array.isArray(metadata.content.canvasDevices)
      ? metadata.content.canvasDevices
      : [],
  }

  return composeProjectSnapshot(contentSnapshot, {
    activeFileId: metadata.workspaceView.activeFileId,
  })
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

async function hydratePersistedImplementationManifest(metadataPath: string) {
  const manifestPath = getProjectImplementationManifestPath(metadataPath)
  if (!manifestPath) {
    return
  }

  try {
    const raw = await invoke<string>('read_project_file', { path: manifestPath })
    const manifest = parseImplementationArtifactManifest(JSON.parse(raw) as unknown)
    if (!manifest) {
      return
    }

    if (
      projectStore.implementationCache &&
      projectStore.implementationCache.signature !== manifest.signature
    ) {
      return
    }

    projectStore.setImplementationCache({
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

async function writePersistedImplementationManifest(
  metadataPath: string,
  options: { preserveArtifacts: boolean },
) {
  const manifestPath = getProjectImplementationManifestPath(metadataPath)
  if (!manifestPath) {
    return
  }

  const manifest = options.preserveArtifacts
    ? createImplementationArtifactManifest(projectStore.implementationCache)
    : null

  await invoke('write_project_file', {
    path: manifestPath,
    content: JSON.stringify(manifest, null, 2),
  })
}

export async function loadProjectFromPath(path: string) {
  const content = await invoke<string>('read_project_file', { path })
  const data = JSON.parse(content) as unknown
  const loadedSnapshot: ProjectSnapshot = isProjectMetadataSnapshot(data)
    ? await hydrateProjectSnapshot(path, data)
    : (data as ProjectSnapshot)
  const loadedSession = buildLoadedProjectSession(loadedSnapshot)

  projectStore.loadFromSnapshot(loadedSnapshot, { projectPath: path })

  await hydratePersistedSynthesisManifest(path)
  await hydratePersistedImplementationManifest(path)
  await hardwareStore.replaceCanvasDevices(loadedSession.canvasDevices)

  recentProjectsStore.rememberProject(path, projectStore.toSnapshot().content.name)
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
  await writePersistedImplementationManifest(path, options)
}

export function syncInMemorySynthesisCacheAfterSave(preserveArtifacts: boolean) {
  if (preserveArtifacts) {
    return
  }

  projectStore.setSynthesisCache(clonePersistedSynthesisCache(projectStore.synthesisCache, false))
}

export function syncInMemoryImplementationCacheAfterSave(preserveArtifacts: boolean) {
  if (preserveArtifacts) {
    return
  }

  projectStore.setImplementationCache(
    clonePersistedImplementationCache(projectStore.implementationCache, false),
  )
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
