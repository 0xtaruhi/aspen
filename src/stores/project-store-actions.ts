import type { ProjectStoreLike } from './project'

import { createProjectStoreConfigActions } from './project-store-config-actions'
import { createProjectStoreFileActions } from './project-store-file-actions'
import { createProjectStoreLifecycleActions } from './project-store-lifecycle-actions'
import { findProjectNode, findProjectNodeLocation } from './project-store-view'

export function createProjectStoreActions(store: ProjectStoreLike) {
  const configActions = createProjectStoreConfigActions(store)
  const fileActions = createProjectStoreFileActions(store)
  const lifecycleActions = createProjectStoreLifecycleActions(store)

  const actions: Pick<
    ProjectStoreLike,
    | 'findNode'
    | 'findNodeLocation'
    | 'toSnapshot'
    | 'loadFromSnapshot'
    | 'updateCode'
    | 'setActiveFile'
    | 'setSelectedNode'
    | 'clearCreatingNodeState'
    | 'discardCreatingNode'
    | 'beginRenamingNode'
    | 'cancelRenamingNode'
    | 'beginCreatingFile'
    | 'beginCreatingFolder'
    | 'beginCreatingNode'
    | 'setTopFile'
    | 'setTargetDevice'
    | 'setTargetBoard'
    | 'setImplementationPlaceMode'
    | 'setTopModuleName'
    | 'replacePinConstraints'
    | 'setPinConstraint'
    | 'clearPinConstraint'
    | 'clearPinConstraints'
    | 'setSynthesisCache'
    | 'setImplementationCache'
    | 'markSaved'
    | 'isFileDirty'
    | 'createFile'
    | 'createFolder'
    | 'importFiles'
    | 'deleteNode'
    | 'commitNodeRename'
    | 'moveNode'
    | 'createNewProject'
    | 'clearProject'
  > = {
    ...lifecycleActions,
    ...fileActions,
    ...configActions,

    findNode(id, nodes) {
      return findProjectNode(store, id, nodes)
    },

    findNodeLocation(id, nodes, parent = null) {
      return findProjectNodeLocation(store, id, nodes, parent)
    },
  }

  return actions
}
