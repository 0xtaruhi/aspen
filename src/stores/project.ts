import { reactive } from 'vue'

import { defaultFpgaDeviceId, type FpgaDeviceId } from '../lib/fpga-device-catalog'
import { defaultFpgaBoardId, type FpgaBoardId } from '../lib/fpga-board-catalog'
import {
  cloneProjectConstraintSnapshot,
  emptyProjectConstraintSnapshot,
  type ProjectPinConstraint,
} from '../lib/project-constraints'
import {
  cloneImplementationSettings,
  defaultImplementationSettings,
  type ImplementationPlaceMode,
} from '../lib/implementation-settings'
import {
  cloneProjectCanvasDevices,
  cloneProjectImplementationCacheSnapshot,
  cloneProjectNodes,
  cloneProjectSynthesisCacheSnapshot,
  isHardwareSourceFile,
  parseTopSignals,
  type FileSignatureMap,
  type ProjectImplementationCacheSnapshot,
  type ProjectNode,
  type ProjectSnapshot,
  type ProjectSynthesisCacheSnapshot,
} from './project-model'
import { projectCanvasStore } from './project-canvas'
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
import {
  createFile,
  createFolder,
  deleteNode,
  importFiles,
  moveNode,
} from './project-file-operations'
import {
  beginCreatingNode,
  beginRenamingNode,
  cancelRenamingNode,
  clearCreatingNodeState,
  commitNodeRename,
  discardCreatingNode,
} from './project-inline-edit'
import {
  applyProjectSession,
  buildEmptyProjectSession,
  buildLoadedProjectSession,
  buildTemplateProjectSession,
} from './project-session'
import {
  isFileDirty as isProjectFileDirty,
  markSaved as markProjectSaved,
  setImplementationCache as setProjectImplementationCache,
  setSynthesisCache as setProjectSynthesisCache,
} from './project-save-state'
import { findNodeInTree, findNodeLocationInTree } from './project-tree'
import { type ProjectTemplate } from './project-templates'

export type {
  ProjectImplementationCacheSnapshot,
  ProjectNode,
  ProjectSnapshot,
  ProjectSynthesisCacheSnapshot,
} from './project-model'

export const projectStore = reactive({
  sessionId: 0,
  files: [] as ProjectNode[],

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
  synthesisCache: null as ProjectSynthesisCacheSnapshot | null,
  implementationCache: null as ProjectImplementationCacheSnapshot | null,
  projectPath: null as string | null,
  savedSnapshotJson: '' as string,
  savedFileSignatures: {} as FileSignatureMap,

  // Helper to find a node by ID recursively
  findNode(id: string, nodes?: ProjectNode[]): ProjectNode | null {
    return findNodeInTree(id, nodes || this.files)
  },

  findNodeLocation(id: string, nodes?: ProjectNode[], parent: ProjectNode | null = null) {
    return findNodeLocationInTree(id, nodes || this.files, parent)
  },

  get activeFile() {
    return this.findNode(this.activeFileId)
  },

  get selectedNode() {
    return this.findNode(this.selectedNodeId)
  },

  get rootNode() {
    return this.files.length === 1 && this.files[0]?.type === 'folder' ? this.files[0] : null
  },

  get hasProject() {
    return this.files.length > 0
  },

  get code() {
    return this.activeFile?.content || ''
  },

  get topFile() {
    return this.findNode(this.topFileId)
  },

  get hasUnsavedChanges() {
    return JSON.stringify(this.toSnapshot()) !== this.savedSnapshotJson
  },

  get topCode() {
    return this.topFile?.content || ''
  },

  get topSignals() {
    return parseTopSignals(this.topFile)
  },

  get signals() {
    if (this.activeFile?.type === 'file' && isHardwareSourceFile(this.activeFile.name)) {
      return parseTopSignals(this.activeFile)
    }
    return []
  },

  toSnapshot(): ProjectSnapshot {
    return {
      version: 1,
      name: this.files[0]?.name || 'project',
      files: cloneProjectNodes(this.files),
      activeFileId: this.activeFileId,
      topFileId: this.topFileId,
      topModuleName: this.topModuleName,
      targetDeviceId: this.targetDeviceId,
      targetBoardId: this.targetBoardId,
      pinConstraints: cloneProjectConstraintSnapshot(this.pinConstraints),
      implementationSettings: cloneImplementationSettings(this.implementationSettings),
      synthesisCache: cloneProjectSynthesisCacheSnapshot(this.synthesisCache),
      implementationCache: cloneProjectImplementationCacheSnapshot(this.implementationCache),
      canvasDevices: cloneProjectCanvasDevices(projectCanvasStore.canvasDevices.value),
    }
  },

  loadFromSnapshot(snapshot: unknown, options: { projectPath?: string | null } = {}) {
    const session = buildLoadedProjectSession(snapshot)
    applyProjectSession(this, session)
    projectCanvasStore.setCanvasDevices(session.canvasDevices)
    this.sessionId += 1
    this.markSaved(options.projectPath ?? null)
  },

  updateCode(newCode: string) {
    const file = this.activeFile
    if (file && file.type === 'file') {
      file.content = newCode
    }
  },

  setActiveFile(id: string) {
    this.activeFileId = id
    this.selectedNodeId = id
  },

  setSelectedNode(id: string) {
    this.selectedNodeId = id
  },

  clearCreatingNodeState() {
    clearCreatingNodeState(this)
  },

  discardCreatingNode(id?: string) {
    return discardCreatingNode(this, id)
  },

  beginRenamingNode(id: string) {
    beginRenamingNode(this, id)
  },

  cancelRenamingNode(id?: string) {
    cancelRenamingNode(this, id)
  },

  beginCreatingFile(parentId: string, initialName = 'new_file.v') {
    return this.beginCreatingNode(parentId, 'file', initialName)
  },

  beginCreatingFolder(parentId: string, initialName = 'New Folder') {
    return this.beginCreatingNode(parentId, 'folder', initialName)
  },

  beginCreatingNode(parentId: string, type: 'file' | 'folder', initialName: string) {
    return beginCreatingNode(this, parentId, type, initialName)
  },

  setTopFile(id: string) {
    setProjectTopFile(this, id)
  },

  setTargetDevice(deviceId: FpgaDeviceId) {
    setProjectTargetDevice(this, deviceId)
  },

  setTargetBoard(boardId: FpgaBoardId) {
    setProjectTargetBoard(this, boardId)
  },

  setImplementationPlaceMode(mode: ImplementationPlaceMode) {
    setProjectImplementationPlaceMode(this, mode)
  },

  setTopModuleName(name: string) {
    setProjectTopModuleName(this, name)
  },

  replacePinConstraints(topFileId: string, assignments: ProjectPinConstraint[]) {
    replaceProjectPinConstraints(this, topFileId, assignments)
  },

  setPinConstraint(topFileId: string, assignment: ProjectPinConstraint | null) {
    setProjectPinConstraint(this, topFileId, assignment)
  },

  clearPinConstraint(topFileId: string, portName: string) {
    clearProjectPinConstraint(this, topFileId, portName)
  },

  clearPinConstraints(topFileId?: string) {
    clearProjectPinConstraints(this, topFileId)
  },

  setSynthesisCache(snapshot: ProjectSynthesisCacheSnapshot | null) {
    setProjectSynthesisCache(this, snapshot)
  },

  setImplementationCache(snapshot: ProjectImplementationCacheSnapshot | null) {
    setProjectImplementationCache(this, snapshot)
  },

  markSaved(projectPath?: string | null) {
    markProjectSaved(this, projectPath)
  },

  isFileDirty(id: string) {
    return isProjectFileDirty(this, id)
  },

  // File Operations
  createFile(parentId: string, name: string) {
    createFile(this, parentId, name)
  },

  createFolder(parentId: string, name: string) {
    createFolder(this, parentId, name)
  },

  importFiles(parentId: string, files: Array<{ name: string; content: string }>) {
    importFiles(this, parentId, files)
  },

  deleteNode(id: string) {
    deleteNode(this, id)
  },

  commitNodeRename(id: string, newName: string) {
    return commitNodeRename(this, id, newName)
  },

  moveNode(id: string, targetParentId: string | null, targetIndex: number) {
    return moveNode(this, id, targetParentId, targetIndex)
  },

  createNewProject(name: string, template: ProjectTemplate) {
    const session = buildTemplateProjectSession(name, template)
    applyProjectSession(this, session)
    projectCanvasStore.setCanvasDevices(session.canvasDevices)
    this.sessionId += 1
    this.markSaved(null)
  },

  clearProject() {
    const session = buildEmptyProjectSession()
    applyProjectSession(this, session)
    projectCanvasStore.setCanvasDevices(session.canvasDevices)
    this.sessionId += 1
    this.markSaved(null)
  },
})

projectStore.markSaved(null)
