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
      return discardCreatingNode(store, id)
    },

    beginRenamingNode(id) {
      beginRenamingNode(store, id)
    },

    cancelRenamingNode(id) {
      cancelRenamingNode(store, id)
    },

    beginCreatingFile(parentId, initialName = 'new_file.v') {
      return beginCreatingNode(store, parentId, 'file', initialName)
    },

    beginCreatingFolder(parentId, initialName = 'New Folder') {
      return beginCreatingNode(store, parentId, 'folder', initialName)
    },

    beginCreatingNode(parentId, type, initialName) {
      return beginCreatingNode(store, parentId, type, initialName)
    },

    createFile(parentId, name) {
      createFile(store, parentId, name)
    },

    createFolder(parentId, name) {
      createFolder(store, parentId, name)
    },

    importFiles(parentId, files) {
      importFiles(store, parentId, files)
    },

    deleteNode(id) {
      deleteNode(store, id)
    },

    commitNodeRename(id, newName) {
      return commitNodeRename(store, id, newName)
    },

    moveNode(id, targetParentId, targetIndex) {
      return moveNode(store, id, targetParentId, targetIndex)
    },
  }
}
