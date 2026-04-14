import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import type { FpgaBoardId } from '@/lib/fpga-board-catalog'
import type { FpgaDeviceId } from '@/lib/fpga-device-catalog'
import type { ProjectConstraintSnapshot } from '@/lib/project-constraints'
import type { ImplementationSettingsSnapshot } from '@/lib/implementation-settings'

import { defaultFpgaBoardId } from '@/lib/fpga-board-catalog'
import { defaultFpgaDeviceId } from '@/lib/fpga-device-catalog'
import {
  cloneImplementationSettings,
  defaultImplementationSettings,
} from '@/lib/implementation-settings'
import {
  cloneProjectConstraintSnapshot,
  emptyProjectConstraintSnapshot,
} from '@/lib/project-constraints'

import {
  buildFileSignatureMap,
  cloneProjectCanvasDevices,
  cloneProjectImplementationCacheSnapshot,
  cloneProjectNodes,
  cloneProjectSynthesisCacheSnapshot,
  findFirstFileId,
  normalizeProjectSnapshot,
  resolveTopFileId,
  serializeProjectContentSnapshot,
  splitProjectSnapshot,
  type FileSignatureMap,
  type ProjectImplementationCacheSnapshot,
  type ProjectNode,
  type ProjectSnapshot,
  type ProjectSynthesisCacheSnapshot,
} from './project-model'
import { projectCanvasStore } from './project-canvas'
import { findNodeInTree } from './project-tree'
import { createProjectTemplateState, type ProjectTemplate } from './project-templates'

export interface ProjectSessionPayload {
  files: ProjectNode[]
  activeFileId: string
  selectedNodeId: string
  renamingNodeId: string
  creatingNodeId: string
  selectionBeforeCreatingNodeId: string
  activeFileBeforeCreatingNodeId: string
  topFileId: string
  topModuleName: string
  targetDeviceId: FpgaDeviceId
  targetBoardId: FpgaBoardId
  pinConstraints: ProjectConstraintSnapshot
  implementationSettings: ImplementationSettingsSnapshot
  synthesisCache: ProjectSynthesisCacheSnapshot | null
  implementationCache: ProjectImplementationCacheSnapshot | null
  canvasDevices: CanvasDeviceSnapshot[]
}

export interface ProjectSessionStoreLike {
  files: ProjectNode[]
  activeFileId: string
  selectedNodeId: string
  renamingNodeId: string
  creatingNodeId: string
  selectionBeforeCreatingNodeId: string
  activeFileBeforeCreatingNodeId: string
  topFileId: string
  topModuleName: string
  targetDeviceId: FpgaDeviceId
  targetBoardId: FpgaBoardId
  pinConstraints: ProjectConstraintSnapshot
  implementationSettings: ImplementationSettingsSnapshot
  synthesisCache: ProjectSynthesisCacheSnapshot | null
  implementationCache: ProjectImplementationCacheSnapshot | null
  projectPath: string | null
  savedContentSnapshotJson: string
  cachedContentSnapshotJson: string
  contentSnapshotCacheDirty: boolean
  cachedCanvasRevision: number
  savedFileSignatures: FileSignatureMap
  toSnapshot(): ProjectSnapshot
}

export function invalidateProjectContentSnapshotCache(
  store: Pick<ProjectSessionStoreLike, 'contentSnapshotCacheDirty'>,
) {
  store.contentSnapshotCacheDirty = true
}

function createTransientProjectUiState() {
  return {
    renamingNodeId: '',
    creatingNodeId: '',
    selectionBeforeCreatingNodeId: '',
    activeFileBeforeCreatingNodeId: '',
  }
}

export function buildLoadedProjectSession(snapshot: unknown): ProjectSessionPayload {
  const parsedSnapshot = normalizeProjectSnapshot(snapshot)
  const { contentSnapshot, workspaceViewSnapshot } = splitProjectSnapshot(parsedSnapshot)
  const nextFiles = cloneProjectNodes(contentSnapshot.files)
  const activeNode = findNodeInTree(workspaceViewSnapshot.activeFileId, nextFiles)
  const nextActiveFileId =
    activeNode?.type === 'file' ? workspaceViewSnapshot.activeFileId : findFirstFileId(nextFiles)
  const topNode = findNodeInTree(contentSnapshot.topFileId, nextFiles)
  const nextTopFileId =
    topNode?.type === 'file' ? contentSnapshot.topFileId : resolveTopFileId(nextFiles)
  const nextPinConstraints = cloneProjectConstraintSnapshot(contentSnapshot.pinConstraints)
  const resolvedConstraintTarget = nextPinConstraints.topFileId
    ? findNodeInTree(nextPinConstraints.topFileId, nextFiles)
    : null
  if ((!resolvedConstraintTarget || resolvedConstraintTarget.type !== 'file') && nextTopFileId) {
    nextPinConstraints.topFileId = nextTopFileId
  }

  return {
    files: nextFiles,
    activeFileId: nextActiveFileId,
    selectedNodeId: nextActiveFileId,
    ...createTransientProjectUiState(),
    topFileId: nextTopFileId,
    topModuleName: contentSnapshot.topFileId === nextTopFileId ? contentSnapshot.topModuleName : '',
    targetDeviceId: contentSnapshot.targetDeviceId,
    targetBoardId: contentSnapshot.targetBoardId,
    pinConstraints: nextPinConstraints,
    implementationSettings: cloneImplementationSettings(contentSnapshot.implementationSettings),
    synthesisCache: cloneProjectSynthesisCacheSnapshot(contentSnapshot.synthesisCache),
    implementationCache: cloneProjectImplementationCacheSnapshot(
      contentSnapshot.implementationCache,
    ),
    canvasDevices: cloneProjectCanvasDevices(contentSnapshot.canvasDevices),
  }
}

export function buildTemplateProjectSession(
  name: string,
  template: ProjectTemplate,
): ProjectSessionPayload {
  const nextProject = createProjectTemplateState(name, template)

  return {
    files: nextProject.files,
    activeFileId: nextProject.activeFileId,
    selectedNodeId: nextProject.selectedNodeId,
    ...createTransientProjectUiState(),
    topFileId: nextProject.topFileId,
    topModuleName: nextProject.topModuleName,
    targetDeviceId: defaultFpgaDeviceId,
    targetBoardId: defaultFpgaBoardId,
    pinConstraints: {
      version: 1,
      topFileId: nextProject.topFileId,
      assignments: [],
    },
    implementationSettings: cloneImplementationSettings(defaultImplementationSettings),
    synthesisCache: null,
    implementationCache: null,
    canvasDevices: [],
  }
}

export function buildEmptyProjectSession(): ProjectSessionPayload {
  return {
    files: [],
    activeFileId: '',
    selectedNodeId: '',
    ...createTransientProjectUiState(),
    topFileId: '',
    topModuleName: '',
    targetDeviceId: defaultFpgaDeviceId,
    targetBoardId: defaultFpgaBoardId,
    pinConstraints: emptyProjectConstraintSnapshot(),
    implementationSettings: cloneImplementationSettings(defaultImplementationSettings),
    synthesisCache: null,
    implementationCache: null,
    canvasDevices: [],
  }
}

export function applyProjectSession(
  store: ProjectSessionStoreLike,
  session: ProjectSessionPayload,
) {
  store.files = session.files
  store.activeFileId = session.activeFileId
  store.selectedNodeId = session.selectedNodeId
  store.renamingNodeId = session.renamingNodeId
  store.creatingNodeId = session.creatingNodeId
  store.selectionBeforeCreatingNodeId = session.selectionBeforeCreatingNodeId
  store.activeFileBeforeCreatingNodeId = session.activeFileBeforeCreatingNodeId
  store.topFileId = session.topFileId
  store.topModuleName = session.topModuleName
  store.targetDeviceId = session.targetDeviceId
  store.targetBoardId = session.targetBoardId
  store.pinConstraints = session.pinConstraints
  store.implementationSettings = session.implementationSettings
  store.synthesisCache = session.synthesisCache
  store.implementationCache = session.implementationCache
}

export function markProjectSessionSaved(
  store: ProjectSessionStoreLike,
  projectPath: string | null,
) {
  store.projectPath = projectPath
  const contentSnapshotJson = serializeProjectContentSnapshot(
    splitProjectSnapshot(store.toSnapshot()).contentSnapshot,
  )
  store.savedContentSnapshotJson = contentSnapshotJson
  store.cachedContentSnapshotJson = contentSnapshotJson
  store.contentSnapshotCacheDirty = false
  store.cachedCanvasRevision = projectCanvasStore.snapshotRevision.value
  store.savedFileSignatures = buildFileSignatureMap(store.files)
}
