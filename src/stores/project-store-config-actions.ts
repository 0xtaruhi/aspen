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
import { invalidateProjectSnapshotCache } from './project-session'

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
      invalidateProjectSnapshotCache(store)
    },

    setTargetDevice(deviceId) {
      setProjectTargetDevice(store, deviceId)
      invalidateProjectSnapshotCache(store)
    },

    setTargetBoard(boardId) {
      setProjectTargetBoard(store, boardId)
      invalidateProjectSnapshotCache(store)
    },

    setImplementationPlaceMode(mode) {
      setProjectImplementationPlaceMode(store, mode)
      invalidateProjectSnapshotCache(store)
    },

    setTopModuleName(name) {
      setProjectTopModuleName(store, name)
      invalidateProjectSnapshotCache(store)
    },

    replacePinConstraints(topFileId, assignments) {
      replaceProjectPinConstraints(store, topFileId, assignments)
      invalidateProjectSnapshotCache(store)
    },

    setPinConstraint(topFileId, assignment) {
      setProjectPinConstraint(store, topFileId, assignment)
      invalidateProjectSnapshotCache(store)
    },

    clearPinConstraint(topFileId, portName) {
      clearProjectPinConstraint(store, topFileId, portName)
      invalidateProjectSnapshotCache(store)
    },

    clearPinConstraints(topFileId) {
      clearProjectPinConstraints(store, topFileId)
      invalidateProjectSnapshotCache(store)
    },
  }
}
