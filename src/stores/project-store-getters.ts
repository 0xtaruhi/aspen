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
import { projectCanvasStore } from './project-canvas'
import { serializeProjectContentSnapshot, splitProjectSnapshot } from './project-model'
import { projectWaveformStore } from './project-waveform'

function getCachedContentSnapshotJson(store: ProjectStoreLike) {
  const canvasRevision = projectCanvasStore.snapshotRevision.value
  const waveformRevision = projectWaveformStore.snapshotRevision.value
  if (
    store.contentSnapshotCacheDirty ||
    store.cachedCanvasRevision !== canvasRevision ||
    store.cachedWaveformRevision !== waveformRevision
  ) {
    store.cachedContentSnapshotJson = serializeProjectContentSnapshot(
      splitProjectSnapshot(store.toSnapshot()).contentSnapshot,
    )
    store.contentSnapshotCacheDirty = false
    store.cachedCanvasRevision = canvasRevision
    store.cachedWaveformRevision = waveformRevision
  }

  return store.cachedContentSnapshotJson
}

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
      get: () => getCachedContentSnapshotJson(store) !== store.savedContentSnapshotJson,
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
