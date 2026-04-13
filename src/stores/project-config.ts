import type { FpgaBoardId } from '@/lib/fpga-board-catalog'
import type { FpgaDeviceId } from '@/lib/fpga-device-catalog'
import type {
  ImplementationPlaceMode,
  ImplementationSettingsSnapshot,
} from '@/lib/implementation-settings'
import type { ProjectConstraintSnapshot, ProjectPinConstraint } from '@/lib/project-constraints'

import { getDefaultFpgaBoardIdForDevice } from '@/lib/fpga-board-catalog'

import { isHardwareSourceFile, type ProjectNode } from './project-model'

export interface ProjectConfigStoreLike {
  topFileId: string
  topModuleName: string
  targetDeviceId: FpgaDeviceId
  targetBoardId: FpgaBoardId
  pinConstraints: ProjectConstraintSnapshot
  implementationSettings: ImplementationSettingsSnapshot
  findNode(id: string, nodes?: ProjectNode[]): ProjectNode | null
}

function clonePinAssignments(assignments: readonly ProjectPinConstraint[]): ProjectPinConstraint[] {
  return assignments.map((entry) => ({
    ...entry,
  }))
}

export function setTopFile(store: ProjectConfigStoreLike, id: string) {
  const node = store.findNode(id)
  if (node?.type !== 'file' || !isHardwareSourceFile(node.name)) {
    return
  }

  const topFileChanged = store.topFileId !== id
  store.topFileId = id

  if (topFileChanged) {
    store.topModuleName = ''
  }

  if (store.pinConstraints.topFileId !== id) {
    store.pinConstraints = {
      version: 1,
      topFileId: id,
      assignments: [],
    }
  }
}

export function setTargetDevice(store: ProjectConfigStoreLike, deviceId: FpgaDeviceId) {
  store.targetDeviceId = deviceId
  store.targetBoardId = getDefaultFpgaBoardIdForDevice(deviceId)
}

export function setTargetBoard(store: ProjectConfigStoreLike, boardId: FpgaBoardId) {
  store.targetBoardId = boardId
}

export function setImplementationPlaceMode(
  store: ProjectConfigStoreLike,
  mode: ImplementationPlaceMode,
) {
  store.implementationSettings = {
    ...store.implementationSettings,
    placeMode: mode,
  }
}

export function setTopModuleName(store: ProjectConfigStoreLike, name: string) {
  store.topModuleName = name.trim()
}

export function replacePinConstraints(
  store: ProjectConfigStoreLike,
  topFileId: string,
  assignments: readonly ProjectPinConstraint[],
) {
  store.pinConstraints = {
    version: 1,
    topFileId,
    assignments: clonePinAssignments(assignments),
  }
}

export function setPinConstraint(
  store: ProjectConfigStoreLike,
  topFileId: string,
  assignment: ProjectPinConstraint | null,
) {
  if (!assignment) {
    return
  }

  const nextAssignments =
    store.pinConstraints.topFileId === topFileId
      ? store.pinConstraints.assignments.filter((entry) => entry.portName !== assignment.portName)
      : []

  nextAssignments.push({
    ...assignment,
  })

  replacePinConstraints(store, topFileId, nextAssignments)
}

export function clearPinConstraint(
  store: ProjectConfigStoreLike,
  topFileId: string,
  portName: string,
) {
  const nextAssignments =
    store.pinConstraints.topFileId === topFileId
      ? store.pinConstraints.assignments.filter((entry) => entry.portName !== portName)
      : []

  replacePinConstraints(store, topFileId, nextAssignments)
}

export function clearPinConstraints(store: ProjectConfigStoreLike, topFileId?: string) {
  replacePinConstraints(store, topFileId ?? store.topFileId, [])
}
