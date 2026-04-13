import type { ProjectStoreLike } from './project'

import {
  clearProject,
  createNewProject,
  createProjectSnapshot,
  loadProjectFromSnapshot,
  setActiveProjectFile,
  setSelectedProjectNode,
  updateProjectCode,
} from './project-store-lifecycle'
import {
  isFileDirty as isProjectFileDirty,
  markSaved as markProjectSaved,
  setImplementationCache as setProjectImplementationCache,
  setSynthesisCache as setProjectSynthesisCache,
} from './project-save-state'

export function createProjectStoreLifecycleActions(
  store: ProjectStoreLike,
): Pick<
  ProjectStoreLike,
  | 'toSnapshot'
  | 'loadFromSnapshot'
  | 'updateCode'
  | 'setActiveFile'
  | 'setSelectedNode'
  | 'setSynthesisCache'
  | 'setImplementationCache'
  | 'markSaved'
  | 'isFileDirty'
  | 'createNewProject'
  | 'clearProject'
> {
  return {
    toSnapshot() {
      return createProjectSnapshot(store)
    },

    loadFromSnapshot(snapshot, options = {}) {
      loadProjectFromSnapshot(store, snapshot, options)
    },

    updateCode(newCode) {
      updateProjectCode(store, newCode)
    },

    setActiveFile(id) {
      setActiveProjectFile(store, id)
    },

    setSelectedNode(id) {
      setSelectedProjectNode(store, id)
    },

    setSynthesisCache(snapshot) {
      setProjectSynthesisCache(store, snapshot)
    },

    setImplementationCache(snapshot) {
      setProjectImplementationCache(store, snapshot)
    },

    markSaved(projectPath) {
      markProjectSaved(store, projectPath)
    },

    isFileDirty(id) {
      return isProjectFileDirty(store, id)
    },

    createNewProject(name, template) {
      createNewProject(store, name, template)
    },

    clearProject() {
      clearProject(store)
    },
  }
}
