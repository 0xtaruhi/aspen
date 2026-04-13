import type { ProjectNode } from './project-model'

import {
  createProjectFileNode,
  createProjectFolderNode,
  ensureFolderChildren,
  nextProjectNodeId,
  removeNodeFromTree,
} from './project-tree'

export interface ProjectInlineEditStoreLike {
  files: ProjectNode[]
  activeFileId: string
  selectedNodeId: string
  renamingNodeId: string
  creatingNodeId: string
  selectionBeforeCreatingNodeId: string
  activeFileBeforeCreatingNodeId: string
  findNode(id: string, nodes?: ProjectNode[]): ProjectNode | null
}

export function clearCreatingNodeState(store: ProjectInlineEditStoreLike) {
  store.creatingNodeId = ''
  store.selectionBeforeCreatingNodeId = ''
  store.activeFileBeforeCreatingNodeId = ''
}

export function discardCreatingNode(store: ProjectInlineEditStoreLike, id?: string) {
  const targetId = id ?? store.creatingNodeId
  if (!targetId || store.creatingNodeId !== targetId) {
    return false
  }

  const restoreSelectedNodeId = store.selectionBeforeCreatingNodeId
  const restoreActiveFileId = store.activeFileBeforeCreatingNodeId

  if (!removeNodeFromTree(targetId, store.files)) {
    clearCreatingNodeState(store)
    if (store.renamingNodeId === targetId) {
      store.renamingNodeId = ''
    }
    return false
  }

  if (store.activeFileId === targetId) {
    store.activeFileId = ''
  }
  if (store.selectedNodeId === targetId) {
    store.selectedNodeId = ''
  }
  if (store.renamingNodeId === targetId) {
    store.renamingNodeId = ''
  }

  clearCreatingNodeState(store)

  store.activeFileId = store.findNode(restoreActiveFileId) ? restoreActiveFileId : ''
  store.selectedNodeId = store.findNode(restoreSelectedNodeId)
    ? restoreSelectedNodeId
    : store.activeFileId

  return true
}

export function beginRenamingNode(store: ProjectInlineEditStoreLike, id: string) {
  if (store.creatingNodeId) {
    discardCreatingNode(store, store.creatingNodeId)
  }

  if (!store.findNode(id)) {
    return
  }

  store.selectedNodeId = id
  store.renamingNodeId = id
}

export function cancelRenamingNode(store: ProjectInlineEditStoreLike, id?: string) {
  const targetId = id ?? store.renamingNodeId
  if (!targetId) {
    return
  }

  if (store.creatingNodeId === targetId) {
    discardCreatingNode(store, targetId)
    return
  }

  if (!id || store.renamingNodeId === id) {
    store.renamingNodeId = ''
  }
}

export function beginCreatingNode(
  store: ProjectInlineEditStoreLike,
  parentId: string,
  type: 'file' | 'folder',
  initialName: string,
) {
  const parent = store.findNode(parentId)
  if (!parent || parent.type !== 'folder') {
    return null
  }

  if (store.creatingNodeId) {
    discardCreatingNode(store, store.creatingNodeId)
  } else if (store.renamingNodeId) {
    cancelRenamingNode(store, store.renamingNodeId)
  }

  const id = nextProjectNodeId()
  const node =
    type === 'file'
      ? createProjectFileNode(initialName, { id })
      : createProjectFolderNode(initialName, { id })

  ensureFolderChildren(parent).push(node)
  parent.isOpen = true

  store.selectionBeforeCreatingNodeId = store.selectedNodeId
  store.activeFileBeforeCreatingNodeId = store.activeFileId
  store.creatingNodeId = id
  store.selectedNodeId = id
  store.renamingNodeId = id

  return id
}

export function commitNodeRename(store: ProjectInlineEditStoreLike, id: string, newName: string) {
  const trimmedName = newName.trim()
  const node = store.findNode(id)
  const isCreatingNode = store.creatingNodeId === id
  if (!node) {
    cancelRenamingNode(store, id)
    return { kind: 'discarded' as const, id, nodeType: null }
  }

  store.renamingNodeId = ''
  if (!trimmedName || trimmedName === node.name) {
    if (isCreatingNode && !trimmedName) {
      discardCreatingNode(store, id)
      return { kind: 'discarded' as const, id, nodeType: node.type }
    }

    if (isCreatingNode) {
      clearCreatingNodeState(store)
      if (node.type === 'file') {
        store.activeFileId = id
      }
      return { kind: 'created' as const, id, nodeType: node.type }
    }

    return { kind: 'noop' as const, id, nodeType: node.type }
  }

  node.name = trimmedName

  if (isCreatingNode) {
    clearCreatingNodeState(store)
    if (node.type === 'file') {
      store.activeFileId = id
    }
    return { kind: 'created' as const, id, nodeType: node.type }
  }

  return { kind: 'renamed' as const, id, nodeType: node.type }
}
