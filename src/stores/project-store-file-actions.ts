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
      createFile(store, parentId, name)
      invalidateProjectContentSnapshotCache(store)
    },

    createFolder(parentId, name) {
      createFolder(store, parentId, name)
      invalidateProjectContentSnapshotCache(store)
    },

    importFiles(parentId, files) {
      importFiles(store, parentId, files)
      invalidateProjectContentSnapshotCache(store)
    },

    deleteNode(id) {
      deleteNode(store, id)
      invalidateProjectContentSnapshotCache(store)
    },

    commitNodeRename(id, newName) {
      const result = commitNodeRename(store, id, newName)
      invalidateProjectContentSnapshotCache(store)
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
