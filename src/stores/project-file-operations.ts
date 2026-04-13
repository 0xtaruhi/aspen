import type { ProjectConstraintSnapshot } from '@/lib/project-constraints'

import { resolveTopFileId, type ProjectNode } from './project-model'
import {
  clampInsertionIndex,
  createProjectFileNode,
  createProjectFolderNode,
  ensureFolderChildren,
  nodeContainsDescendantId,
  removeNodeFromTree,
} from './project-tree'

export interface ProjectFileOperationsStoreLike {
  files: ProjectNode[]
  activeFileId: string
  selectedNodeId: string
  renamingNodeId: string
  creatingNodeId: string
  topFileId: string
  topModuleName: string
  pinConstraints: ProjectConstraintSnapshot
  findNode(id: string, nodes?: ProjectNode[]): ProjectNode | null
  findNodeLocation(
    id: string,
    nodes?: ProjectNode[],
    parent?: ProjectNode | null,
  ): {
    node: ProjectNode
    parent: ProjectNode | null
    container: ProjectNode[]
    index: number
  } | null
  clearCreatingNodeState(): void
}

export function createFile(store: ProjectFileOperationsStoreLike, parentId: string, name: string) {
  const parent = store.findNode(parentId)
  if (parent && parent.type === 'folder') {
    const node = createProjectFileNode(name)
    ensureFolderChildren(parent).push(node)
    const id = node.id
    store.activeFileId = id
    store.selectedNodeId = id
    parent.isOpen = true
  }
}

export function createFolder(
  store: ProjectFileOperationsStoreLike,
  parentId: string,
  name: string,
) {
  const parent = store.findNode(parentId)
  if (parent && parent.type === 'folder') {
    const node = createProjectFolderNode(name)
    ensureFolderChildren(parent).push(node)
    store.selectedNodeId = node.id
    parent.isOpen = true
  }
}

export function importFiles(
  store: ProjectFileOperationsStoreLike,
  parentId: string,
  files: Array<{ name: string; content: string }>,
) {
  const parent = store.findNode(parentId)
  if (!parent || parent.type !== 'folder' || files.length === 0) {
    return
  }

  const createdIds: string[] = []
  for (const [index, file] of files.entries()) {
    const id = `${Date.now()}-${index}`
    ensureFolderChildren(parent).push(
      createProjectFileNode(file.name, {
        id,
        content: file.content,
      }),
    )
    createdIds.push(id)
  }

  parent.isOpen = true

  if (!store.activeFileId && createdIds[0]) {
    store.activeFileId = createdIds[0]
  }

  if (createdIds[0]) {
    store.selectedNodeId = createdIds[0]
  }

  if (!store.topFileId) {
    store.topFileId = resolveTopFileId(store.files)
    store.pinConstraints.topFileId = store.topFileId
  }
}

export function deleteNode(store: ProjectFileOperationsStoreLike, id: string) {
  removeNodeFromTree(id, store.files)
  if (store.activeFileId === id) {
    store.activeFileId = ''
  }
  if (store.selectedNodeId === id) {
    store.selectedNodeId = ''
  }
  if (store.renamingNodeId === id) {
    store.renamingNodeId = ''
  }
  if (store.creatingNodeId === id) {
    store.clearCreatingNodeState()
  }
  if (store.topFileId === id) {
    store.topFileId = resolveTopFileId(store.files)
    store.topModuleName = ''
    store.pinConstraints = {
      version: 1,
      topFileId: store.topFileId,
      assignments: [],
    }
  }
}

export function moveNode(
  store: ProjectFileOperationsStoreLike,
  id: string,
  targetParentId: string | null,
  targetIndex: number,
) {
  const source = store.findNodeLocation(id)
  if (!source) {
    return false
  }

  const targetParent = targetParentId ? store.findNode(targetParentId) : null
  if (targetParent && targetParent.type !== 'folder') {
    return false
  }

  if (targetParent && source.node.type === 'folder') {
    if (
      targetParent.id === source.node.id ||
      nodeContainsDescendantId(source.node, targetParent.id)
    ) {
      return false
    }
  }

  const targetContainer = targetParent ? (targetParent.children ??= []) : store.files
  let insertionIndex = clampInsertionIndex(targetIndex, targetContainer.length)

  if (source.container === targetContainer) {
    if (source.index === insertionIndex || source.index + 1 === insertionIndex) {
      return true
    }
    if (source.index < insertionIndex) {
      insertionIndex -= 1
    }
  }

  const [movedNode] = source.container.splice(source.index, 1)
  if (!movedNode) {
    return false
  }

  targetContainer.splice(insertionIndex, 0, movedNode)

  if (targetParent) {
    targetParent.isOpen = true
  }

  return true
}
