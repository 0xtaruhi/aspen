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
    },

    setTargetDevice(deviceId) {
      setProjectTargetDevice(store, deviceId)
    },

    setTargetBoard(boardId) {
      setProjectTargetBoard(store, boardId)
    },

    setImplementationPlaceMode(mode) {
      setProjectImplementationPlaceMode(store, mode)
    },

    setTopModuleName(name) {
      setProjectTopModuleName(store, name)
    },

    replacePinConstraints(topFileId, assignments) {
      replaceProjectPinConstraints(store, topFileId, assignments)
    },

    setPinConstraint(topFileId, assignment) {
      setProjectPinConstraint(store, topFileId, assignment)
    },

    clearPinConstraint(topFileId, portName) {
      clearProjectPinConstraint(store, topFileId, portName)
    },

    clearPinConstraints(topFileId) {
      clearProjectPinConstraints(store, topFileId)
    },
  }
}
