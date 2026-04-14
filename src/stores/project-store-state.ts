import type { FpgaBoardId } from '../lib/fpga-board-catalog'
import type { FpgaDeviceId } from '../lib/fpga-device-catalog'
import type { ProjectConstraintSnapshot } from '../lib/project-constraints'
import type {
  ImplementationPlaceMode,
  ImplementationSettingsSnapshot,
} from '../lib/implementation-settings'

import { defaultFpgaBoardId } from '../lib/fpga-board-catalog'
import { defaultFpgaDeviceId } from '../lib/fpga-device-catalog'
import {
  cloneImplementationSettings,
  defaultImplementationSettings,
} from '../lib/implementation-settings'
import {
  emptyProjectConstraintSnapshot,
  type ProjectPinConstraint,
} from '../lib/project-constraints'

import type {
  FileSignatureMap,
  ProjectImplementationCacheSnapshot,
  ProjectNode,
  ProjectSynthesisCacheSnapshot,
} from './project-model'

export interface ProjectStoreState {
  sessionId: number
  files: ProjectNode[]
  activeFileId: string
  selectedNodeId: string
  renamingNodeId: string
  creatingNodeId: string
  selectionBeforeCreatingNodeId: string
  activeFileBeforeCreatingNodeId: string
  topFileId: string
  topModuleName: string
  targetDeviceId: FpgaDeviceId
  targetBoardId: FpgaBoardId
  pinConstraints: ProjectConstraintSnapshot
  implementationSettings: ImplementationSettingsSnapshot
  synthesisCache: ProjectSynthesisCacheSnapshot | null
  implementationCache: ProjectImplementationCacheSnapshot | null
  projectPath: string | null
  savedContentSnapshotJson: string
  cachedContentSnapshotJson: string
  contentSnapshotCacheDirty: boolean
  cachedCanvasRevision: number
  savedFileSignatures: FileSignatureMap
}

export interface ProjectConfigStoreLike extends ProjectStoreState {
  setTopFile(id: string): void
  setTargetDevice(deviceId: FpgaDeviceId): void
  setTargetBoard(boardId: FpgaBoardId): void
  setImplementationPlaceMode(mode: ImplementationPlaceMode): void
  setTopModuleName(name: string): void
  replacePinConstraints(topFileId: string, assignments: ProjectPinConstraint[]): void
  setPinConstraint(topFileId: string, assignment: ProjectPinConstraint | null): void
  clearPinConstraint(topFileId: string, portName: string): void
  clearPinConstraints(topFileId?: string): void
}

export function createProjectStoreState(): ProjectStoreState {
  return {
    sessionId: 0,
    files: [],
    activeFileId: '',
    selectedNodeId: '',
    renamingNodeId: '',
    creatingNodeId: '',
    selectionBeforeCreatingNodeId: '',
    activeFileBeforeCreatingNodeId: '',
    topFileId: '',
    topModuleName: '',
    targetDeviceId: defaultFpgaDeviceId,
    targetBoardId: defaultFpgaBoardId,
    pinConstraints: emptyProjectConstraintSnapshot(),
    implementationSettings: cloneImplementationSettings(defaultImplementationSettings),
    synthesisCache: null,
    implementationCache: null,
    projectPath: null,
    savedContentSnapshotJson: '',
    cachedContentSnapshotJson: '',
    contentSnapshotCacheDirty: true,
    cachedCanvasRevision: 0,
    savedFileSignatures: {},
  }
}
