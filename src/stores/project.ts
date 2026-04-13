import { reactive } from 'vue'

import { type FpgaDeviceId } from '../lib/fpga-device-catalog'
import { type FpgaBoardId } from '../lib/fpga-board-catalog'
import { type ProjectPinConstraint } from '../lib/project-constraints'
import { type ImplementationPlaceMode } from '../lib/implementation-settings'
import {
  type ProjectImplementationCacheSnapshot,
  type ProjectNode,
  type ProjectSnapshot,
  type ProjectSynthesisCacheSnapshot,
} from './project-model'
import { type ProjectSessionStoreLike } from './project-session'
import { createProjectStoreActions } from './project-store-actions'
import { createProjectStoreGetterDescriptors } from './project-store-getters'
import { createProjectStoreState, type ProjectStoreState } from './project-store-state'
import { type ProjectNodeLocation } from './project-tree'
import { type ProjectTemplate } from './project-templates'

export type {
  ProjectContentSnapshot,
  ProjectImplementationCacheSnapshot,
  ProjectNode,
  ProjectSnapshot,
  ProjectSynthesisCacheSnapshot,
  ProjectWorkspaceViewSnapshot,
} from './project-model'

export type ProjectStoreLike = ProjectStoreState &
  ProjectSessionStoreLike & {
    sessionId: number
    findNode(id: string, nodes?: ProjectNode[]): ProjectNode | null
    findNodeLocation(
      id: string,
      nodes?: ProjectNode[],
      parent?: ProjectNode | null,
    ): ProjectNodeLocation | null
    activeFile: ProjectNode | null
    selectedNode: ProjectNode | null
    rootNode: ProjectNode | null
    hasProject: boolean
    code: string
    topFile: ProjectNode | null
    hasUnsavedChanges: boolean
    topCode: string
    topSignals: ReturnType<(typeof import('./project-store-view'))['getProjectTopSignals']>
    signals: ReturnType<(typeof import('./project-store-view'))['getProjectSignals']>
    toSnapshot(): ProjectSnapshot
    loadFromSnapshot(snapshot: unknown, options?: { projectPath?: string | null }): void
    updateCode(newCode: string): void
    setActiveFile(id: string): void
    setSelectedNode(id: string): void
    clearCreatingNodeState(): void
    discardCreatingNode(id?: string): boolean
    beginRenamingNode(id: string): void
    cancelRenamingNode(id?: string): void
    beginCreatingFile(parentId: string, initialName?: string): string | null
    beginCreatingFolder(parentId: string, initialName?: string): string | null
    beginCreatingNode(parentId: string, type: 'file' | 'folder', initialName: string): string | null
    setTopFile(id: string): void
    setTargetDevice(deviceId: FpgaDeviceId): void
    setTargetBoard(boardId: FpgaBoardId): void
    setImplementationPlaceMode(mode: ImplementationPlaceMode): void
    setTopModuleName(name: string): void
    replacePinConstraints(topFileId: string, assignments: ProjectPinConstraint[]): void
    setPinConstraint(topFileId: string, assignment: ProjectPinConstraint | null): void
    clearPinConstraint(topFileId: string, portName: string): void
    clearPinConstraints(topFileId?: string): void
    setSynthesisCache(snapshot: ProjectSynthesisCacheSnapshot | null): void
    setImplementationCache(snapshot: ProjectImplementationCacheSnapshot | null): void
    markSaved(projectPath?: string | null): void
    isFileDirty(id: string): boolean
    createFile(parentId: string, name: string): void
    createFolder(parentId: string, name: string): void
    importFiles(parentId: string, files: Array<{ name: string; content: string }>): void
    deleteNode(id: string): void
    commitNodeRename(
      id: string,
      newName: string,
    ):
      | { kind: 'discarded'; id: string; nodeType: ProjectNode['type'] | null }
      | { kind: 'created'; id: string; nodeType: ProjectNode['type'] }
      | { kind: 'noop'; id: string; nodeType: ProjectNode['type'] }
      | { kind: 'renamed'; id: string; nodeType: ProjectNode['type'] }
    moveNode(id: string, targetParentId: string | null, targetIndex: number): boolean
    createNewProject(name: string, template: ProjectTemplate): void
    clearProject(): void
  }

const projectStoreTarget = reactive(createProjectStoreState()) as ProjectStoreLike

Object.assign(projectStoreTarget, createProjectStoreActions(projectStoreTarget))
Object.defineProperties(projectStoreTarget, createProjectStoreGetterDescriptors(projectStoreTarget))

export const projectStore = projectStoreTarget

projectStore.markSaved(null)
