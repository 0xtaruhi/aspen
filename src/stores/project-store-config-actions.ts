import type { ProjectStoreLike } from './project'

import {
  clearPinConstraint as clearProjectPinConstraint,
  clearPinConstraints as clearProjectPinConstraints,
  replacePinConstraints as replaceProjectPinConstraints,
  setImplementationPlaceMode as setProjectImplementationPlaceMode,
  setPinConstraint as setProjectPinConstraint,
  setTargetBoard as setProjectTargetBoard,
  setTargetDevice as setProjectTargetDevice,
  setTopFile as setProjectTopFile,
  setTopModuleName as setProjectTopModuleName,
} from './project-config'
import { invalidateProjectContentSnapshotCache } from './project-session'

export function createProjectStoreConfigActions(
  store: ProjectStoreLike,
): Pick<
  ProjectStoreLike,
  | 'setTopFile'
  | 'setTargetDevice'
  | 'setTargetBoard'
  | 'setImplementationPlaceMode'
  | 'setTopModuleName'
  | 'replacePinConstraints'
  | 'setPinConstraint'
  | 'clearPinConstraint'
  | 'clearPinConstraints'
> {
  return {
    setTopFile(id) {
      setProjectTopFile(store, id)
      invalidateProjectContentSnapshotCache(store)
    },

    setTargetDevice(deviceId) {
      setProjectTargetDevice(store, deviceId)
      invalidateProjectContentSnapshotCache(store)
    },

    setTargetBoard(boardId) {
      setProjectTargetBoard(store, boardId)
      invalidateProjectContentSnapshotCache(store)
    },

    setImplementationPlaceMode(mode) {
      setProjectImplementationPlaceMode(store, mode)
      invalidateProjectContentSnapshotCache(store)
    },

    setTopModuleName(name) {
      setProjectTopModuleName(store, name)
      invalidateProjectContentSnapshotCache(store)
    },

    replacePinConstraints(topFileId, assignments) {
      replaceProjectPinConstraints(store, topFileId, assignments)
      invalidateProjectContentSnapshotCache(store)
    },

    setPinConstraint(topFileId, assignment) {
      setProjectPinConstraint(store, topFileId, assignment)
      invalidateProjectContentSnapshotCache(store)
    },

    clearPinConstraint(topFileId, portName) {
      clearProjectPinConstraint(store, topFileId, portName)
      invalidateProjectContentSnapshotCache(store)
    },

    clearPinConstraints(topFileId) {
      clearProjectPinConstraints(store, topFileId)
      invalidateProjectContentSnapshotCache(store)
    },
  }
}
