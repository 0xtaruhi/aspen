import type { ProjectNode } from './project-model'

import { isHardwareSourceFile, parseTopSignals } from './project-model'
import { findNodeInTree, findNodeLocationInTree } from './project-tree'

export interface ProjectStoreViewLike {
  files: ProjectNode[]
  activeFileId: string
  selectedNodeId: string
  topFileId: string
}

export function findProjectNode(
  store: ProjectStoreViewLike,
  id: string,
  nodes?: ProjectNode[],
): ProjectNode | null {
  return findNodeInTree(id, nodes || store.files)
}

export function findProjectNodeLocation(
  store: ProjectStoreViewLike,
  id: string,
  nodes?: ProjectNode[],
  parent: ProjectNode | null = null,
) {
  return findNodeLocationInTree(id, nodes || store.files, parent)
}

export function getActiveProjectFile(store: ProjectStoreViewLike) {
  return findProjectNode(store, store.activeFileId)
}

export function getSelectedProjectNode(store: ProjectStoreViewLike) {
  return findProjectNode(store, store.selectedNodeId)
}

export function getProjectRootNode(store: ProjectStoreViewLike) {
  return store.files.length === 1 && store.files[0]?.type === 'folder' ? store.files[0] : null
}

export function getProjectTopFile(store: ProjectStoreViewLike) {
  return findProjectNode(store, store.topFileId)
}

export function getProjectCode(store: ProjectStoreViewLike) {
  return getActiveProjectFile(store)?.content || ''
}

export function getProjectTopCode(store: ProjectStoreViewLike) {
  return getProjectTopFile(store)?.content || ''
}

export function getProjectTopSignals(store: ProjectStoreViewLike) {
  return parseTopSignals(getProjectTopFile(store))
}

export function getProjectSignals(store: ProjectStoreViewLike) {
  const activeFile = getActiveProjectFile(store)
  if (activeFile?.type === 'file' && isHardwareSourceFile(activeFile.name)) {
    return parseTopSignals(activeFile)
  }

  return []
}
