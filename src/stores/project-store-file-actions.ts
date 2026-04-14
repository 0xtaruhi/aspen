import type { ProjectStoreLike } from './project'

import {
  createFile,
  createFolder,
  deleteNode,
  importFiles,
  moveNode,
} from './project-file-operations'
import {
  beginCreatingNode,
  beginRenamingNode,
  cancelRenamingNode,
  clearCreatingNodeState,
  commitNodeRename,
  discardCreatingNode,
} from './project-inline-edit'
import { invalidateProjectContentSnapshotCache } from './project-session'

export function createProjectStoreFileActions(
  store: ProjectStoreLike,
): Pick<
  ProjectStoreLike,
  | 'clearCreatingNodeState'
  | 'discardCreatingNode'
  | 'beginRenamingNode'
  | 'cancelRenamingNode'
  | 'beginCreatingFile'
  | 'beginCreatingFolder'
  | 'beginCreatingNode'
  | 'createFile'
  | 'createFolder'
  | 'importFiles'
  | 'deleteNode'
  | 'commitNodeRename'
  | 'moveNode'
> {
  return {
    clearCreatingNodeState() {
      clearCreatingNodeState(store)
    },

    discardCreatingNode(id) {
      const result = discardCreatingNode(store, id)
      if (result) {
        invalidateProjectContentSnapshotCache(store)
      }
      return result
    },

    beginRenamingNode(id) {
      beginRenamingNode(store, id)
    },

    cancelRenamingNode(id) {
      cancelRenamingNode(store, id)
    },

    beginCreatingFile(parentId, initialName = 'new_file.v') {
      const createdId = beginCreatingNode(store, parentId, 'file', initialName)
      if (createdId) {
        invalidateProjectContentSnapshotCache(store)
      }
      return createdId
    },

    beginCreatingFolder(parentId, initialName = 'New Folder') {
      const createdId = beginCreatingNode(store, parentId, 'folder', initialName)
      if (createdId) {
        invalidateProjectContentSnapshotCache(store)
      }
      return createdId
    },

    beginCreatingNode(parentId, type, initialName) {
      const createdId = beginCreatingNode(store, parentId, type, initialName)
      if (createdId) {
        invalidateProjectContentSnapshotCache(store)
      }
      return createdId
    },

    createFile(parentId, name) {
      const created = createFile(store, parentId, name)
      if (created) {
        invalidateProjectContentSnapshotCache(store)
      }
      return created
    },

    createFolder(parentId, name) {
      const created = createFolder(store, parentId, name)
      if (created) {
        invalidateProjectContentSnapshotCache(store)
      }
      return created
    },

    importFiles(parentId, files) {
      const result = importFiles(store, parentId, files)
      if (result.createdIds.length > 0) {
        invalidateProjectContentSnapshotCache(store)
      }
      return result
    },

    deleteNode(id) {
      deleteNode(store, id)
      invalidateProjectContentSnapshotCache(store)
    },

    commitNodeRename(id, newName) {
      const result = commitNodeRename(store, id, newName)
      if (result.kind === 'created' || result.kind === 'discarded' || result.kind === 'renamed') {
        invalidateProjectContentSnapshotCache(store)
      }
      return result
    },

    moveNode(id, targetParentId, targetIndex) {
      const moved = moveNode(store, id, targetParentId, targetIndex)
      if (moved) {
        invalidateProjectContentSnapshotCache(store)
      }
      return moved
    },
  }
}
