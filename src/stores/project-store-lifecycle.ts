import type { ProjectTemplate } from './project-templates'
import type { ProjectStoreState } from './project-store-state'
import type { ProjectSessionStoreLike } from './project-session'

import {
  cloneImplementationSettings,
  type ImplementationSettingsSnapshot,
} from '@/lib/implementation-settings'
import {
  cloneProjectConstraintSnapshot,
  type ProjectConstraintSnapshot,
} from '@/lib/project-constraints'

import {
  cloneProjectCanvasDevices,
  cloneProjectImplementationCacheSnapshot,
  cloneProjectNodes,
  cloneProjectSynthesisCacheSnapshot,
  composeProjectSnapshot,
  type ProjectContentSnapshot,
  type ProjectSnapshot,
  type ProjectWorkspaceViewSnapshot,
} from './project-model'
import { projectCanvasStore } from './project-canvas'
import {
  applyProjectSession,
  buildEmptyProjectSession,
  buildLoadedProjectSession,
  buildTemplateProjectSession,
  markProjectSessionSaved,
} from './project-session'
import { getActiveProjectFile } from './project-store-view'

interface ProjectStoreLifecycleLike extends ProjectSessionStoreLike, ProjectStoreState {
  sessionId: number
}

export function createProjectContentSnapshot(
  store: ProjectStoreLifecycleLike,
): ProjectContentSnapshot {
  return {
    name: store.files[0]?.name || 'project',
    files: cloneProjectNodes(store.files),
    topFileId: store.topFileId,
    topModuleName: store.topModuleName,
    targetDeviceId: store.targetDeviceId,
    targetBoardId: store.targetBoardId,
    pinConstraints: cloneProjectConstraintSnapshot(
      store.pinConstraints as ProjectConstraintSnapshot,
    ),
    implementationSettings: cloneImplementationSettings(
      store.implementationSettings as ImplementationSettingsSnapshot,
    ),
    synthesisCache: cloneProjectSynthesisCacheSnapshot(store.synthesisCache),
    implementationCache: cloneProjectImplementationCacheSnapshot(store.implementationCache),
    canvasDevices: cloneProjectCanvasDevices(projectCanvasStore.canvasDevices.value),
  }
}

export function createProjectWorkspaceViewSnapshot(
  store: ProjectStoreLifecycleLike,
): ProjectWorkspaceViewSnapshot {
  return {
    activeFileId: store.activeFileId,
  }
}

export function createProjectSnapshot(store: ProjectStoreLifecycleLike): ProjectSnapshot {
  return composeProjectSnapshot(
    createProjectContentSnapshot(store),
    createProjectWorkspaceViewSnapshot(store),
  )
}

export function loadProjectFromSnapshot(
  store: ProjectStoreLifecycleLike,
  snapshot: unknown,
  options: { projectPath?: string | null } = {},
) {
  const session = buildLoadedProjectSession(snapshot)
  applyProjectSession(store, session)
  projectCanvasStore.setCanvasDevices(session.canvasDevices)
  store.sessionId += 1
  markProjectSessionSaved(store, options.projectPath ?? null)
}

export function updateProjectCode(store: ProjectStoreLifecycleLike, newCode: string) {
  const file = getActiveProjectFile(store)
  if (file && file.type === 'file') {
    file.content = newCode
  }
}

export function setActiveProjectFile(store: ProjectStoreLifecycleLike, id: string) {
  store.activeFileId = id
  store.selectedNodeId = id
}

export function setSelectedProjectNode(store: ProjectStoreLifecycleLike, id: string) {
  store.selectedNodeId = id
}

export function createNewProject(
  store: ProjectStoreLifecycleLike,
  name: string,
  template: ProjectTemplate,
) {
  const session = buildTemplateProjectSession(name, template)
  applyProjectSession(store, session)
  projectCanvasStore.setCanvasDevices(session.canvasDevices)
  store.sessionId += 1
  markProjectSessionSaved(store, null)
}

export function clearProject(store: ProjectStoreLifecycleLike) {
  const session = buildEmptyProjectSession()
  applyProjectSession(store, session)
  projectCanvasStore.setCanvasDevices(session.canvasDevices)
  store.sessionId += 1
  markProjectSessionSaved(store, null)
}
