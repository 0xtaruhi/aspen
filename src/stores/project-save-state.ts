import type {
  ProjectImplementationCacheSnapshot,
  ProjectNode,
  ProjectSynthesisCacheSnapshot,
} from './project-model'

import {
  cloneProjectImplementationCacheSnapshot,
  cloneProjectSynthesisCacheSnapshot,
  createFileSignature,
} from './project-model'
import { markProjectSessionSaved, type ProjectSessionStoreLike } from './project-session'

export interface ProjectSaveStateStoreLike extends ProjectSessionStoreLike {
  findNode(id: string, nodes?: ProjectNode[]): ProjectNode | null
  synthesisCache: ProjectSynthesisCacheSnapshot | null
  implementationCache: ProjectImplementationCacheSnapshot | null
}

export function setSynthesisCache(
  store: ProjectSaveStateStoreLike,
  snapshot: ProjectSynthesisCacheSnapshot | null,
) {
  store.synthesisCache = cloneProjectSynthesisCacheSnapshot(snapshot)
}

export function setImplementationCache(
  store: ProjectSaveStateStoreLike,
  snapshot: ProjectImplementationCacheSnapshot | null,
) {
  store.implementationCache = cloneProjectImplementationCacheSnapshot(snapshot)
}

export function markSaved(store: ProjectSaveStateStoreLike, projectPath?: string | null) {
  markProjectSessionSaved(store, projectPath === undefined ? store.projectPath : projectPath)
}

export function isFileDirty(store: ProjectSaveStateStoreLike, id: string) {
  const node = store.findNode(id)
  if (!node || node.type !== 'file') {
    return false
  }

  return store.savedFileSignatures[id] !== createFileSignature(node)
}
