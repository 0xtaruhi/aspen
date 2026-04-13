import type { ProjectStoreLike } from './project'

import {
  getActiveProjectFile,
  getProjectCode,
  getProjectRootNode,
  getProjectSignals,
  getProjectTopCode,
  getProjectTopFile,
  getProjectTopSignals,
  getSelectedProjectNode,
} from './project-store-view'

export function createProjectStoreGetterDescriptors(
  store: ProjectStoreLike,
): PropertyDescriptorMap {
  return {
    activeFile: {
      enumerable: true,
      configurable: true,
      get: () => getActiveProjectFile(store),
    },
    selectedNode: {
      enumerable: true,
      configurable: true,
      get: () => getSelectedProjectNode(store),
    },
    rootNode: {
      enumerable: true,
      configurable: true,
      get: () => getProjectRootNode(store),
    },
    hasProject: {
      enumerable: true,
      configurable: true,
      get: () => store.files.length > 0,
    },
    code: {
      enumerable: true,
      configurable: true,
      get: () => getProjectCode(store),
    },
    topFile: {
      enumerable: true,
      configurable: true,
      get: () => getProjectTopFile(store),
    },
    hasUnsavedChanges: {
      enumerable: true,
      configurable: true,
      get: () => JSON.stringify(store.toSnapshot()) !== store.savedSnapshotJson,
    },
    topCode: {
      enumerable: true,
      configurable: true,
      get: () => getProjectTopCode(store),
    },
    topSignals: {
      enumerable: true,
      configurable: true,
      get: () => getProjectTopSignals(store),
    },
    signals: {
      enumerable: true,
      configurable: true,
      get: () => getProjectSignals(store),
    },
  }
}
