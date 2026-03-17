import { reactive } from 'vue'

import { defaultFpgaDeviceId, type FpgaDeviceId } from '../lib/fpga-device-catalog'
import {
  defaultFpgaBoardId,
  getDefaultFpgaBoardIdForDevice,
  type FpgaBoardId,
} from '../lib/fpga-board-catalog'
import {
  cloneProjectConstraintSnapshot,
  emptyProjectConstraintSnapshot,
  type ProjectPinConstraint,
} from '../lib/project-constraints'
import {
  cloneImplementationSettings,
  defaultImplementationSettings,
  type ImplementationPlaceMode,
  type ImplementationRouteMode,
} from '../lib/implementation-settings'
import {
  buildFileSignatureMap,
  cloneProjectCanvasDevices,
  cloneProjectNodes,
  cloneProjectSynthesisCacheSnapshot,
  createFileSignature,
  findFirstFileId,
  isHardwareSourceFile,
  normalizeProjectSnapshot,
  parseTopSignals,
  resolveTopFileId,
  type FileSignatureMap,
  type ProjectNode,
  type ProjectSnapshot,
  type ProjectSynthesisCacheSnapshot,
} from './project-model'
import { createProjectTemplateState, type ProjectTemplate } from './project-templates'
import { virtualDeviceStore } from './virtual-device'

export type { ProjectNode, ProjectSnapshot, ProjectSynthesisCacheSnapshot } from './project-model'

export const projectStore = reactive({
  files: [] as ProjectNode[],

  activeFileId: '',
  selectedNodeId: '',
  topFileId: '',
  topModuleName: '',
  targetDeviceId: defaultFpgaDeviceId,
  targetBoardId: defaultFpgaBoardId,
  pinConstraints: emptyProjectConstraintSnapshot(),
  implementationSettings: cloneImplementationSettings(defaultImplementationSettings),
  synthesisCache: null as ProjectSynthesisCacheSnapshot | null,
  projectPath: null as string | null,
  savedSnapshotJson: '' as string,
  savedFileSignatures: {} as FileSignatureMap,

  // Helper to find a node by ID recursively
  findNode(id: string, nodes?: ProjectNode[]): ProjectNode | null {
    const searchNodes = nodes || this.files
    for (const node of searchNodes) {
      if (node.id === id) return node
      if (node.children) {
        const found = this.findNode(id, node.children)
        if (found) return found
      }
    }
    return null
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
      canvasDevices: cloneProjectCanvasDevices(virtualDeviceStore.canvasDevices.value),
    }
  },

  loadFromSnapshot(snapshot: unknown, options: { projectPath?: string | null } = {}) {
    const parsed = normalizeProjectSnapshot(snapshot)
    const nextFiles = cloneProjectNodes(parsed.files)
    const nextActiveFileId = this.findNode(parsed.activeFileId, nextFiles)
      ? parsed.activeFileId
      : findFirstFileId(nextFiles)
    const nextTopFileId = this.findNode(parsed.topFileId, nextFiles)
      ? parsed.topFileId
      : resolveTopFileId(nextFiles)

    this.files = nextFiles
    this.activeFileId = nextActiveFileId
    this.selectedNodeId = nextActiveFileId
    this.topFileId = nextTopFileId
    this.topModuleName = parsed.topFileId === nextTopFileId ? parsed.topModuleName : ''
    this.targetDeviceId = parsed.targetDeviceId
    this.targetBoardId = parsed.targetBoardId
    this.pinConstraints = cloneProjectConstraintSnapshot(parsed.pinConstraints)
    this.implementationSettings = cloneImplementationSettings(parsed.implementationSettings)
    this.synthesisCache = cloneProjectSynthesisCacheSnapshot(parsed.synthesisCache)
    virtualDeviceStore.setCanvasDevices(parsed.canvasDevices)
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

  setTopFile(id: string) {
    const node = this.findNode(id)
    if (node?.type === 'file' && isHardwareSourceFile(node.name)) {
      const topFileChanged = this.topFileId !== id
      this.topFileId = id
      if (topFileChanged) {
        this.topModuleName = ''
      }
      if (this.pinConstraints.topFileId !== id) {
        this.pinConstraints = {
          version: 1,
          topFileId: id,
          assignments: [],
        }
      }
    }
  },

  setTargetDevice(deviceId: FpgaDeviceId) {
    this.targetDeviceId = deviceId
    this.targetBoardId = getDefaultFpgaBoardIdForDevice(deviceId)
  },

  setTargetBoard(boardId: FpgaBoardId) {
    this.targetBoardId = boardId
  },

  setImplementationPlaceMode(mode: ImplementationPlaceMode) {
    this.implementationSettings = {
      ...this.implementationSettings,
      placeMode: mode,
    }
  },

  setImplementationRouteMode(mode: ImplementationRouteMode) {
    this.implementationSettings = {
      ...this.implementationSettings,
      routeMode: mode,
    }
  },

  setTopModuleName(name: string) {
    this.topModuleName = name.trim()
  },

  replacePinConstraints(topFileId: string, assignments: ProjectPinConstraint[]) {
    this.pinConstraints = {
      version: 1,
      topFileId,
      assignments: assignments.map((entry) => ({
        ...entry,
      })),
    }
  },

  setPinConstraint(topFileId: string, assignment: ProjectPinConstraint | null) {
    if (!assignment) {
      return
    }

    const nextAssignments =
      this.pinConstraints.topFileId === topFileId
        ? this.pinConstraints.assignments.filter((entry) => entry.portName !== assignment.portName)
        : []

    nextAssignments.push({
      ...assignment,
    })

    this.replacePinConstraints(topFileId, nextAssignments)
  },

  clearPinConstraint(topFileId: string, portName: string) {
    const nextAssignments =
      this.pinConstraints.topFileId === topFileId
        ? this.pinConstraints.assignments.filter((entry) => entry.portName !== portName)
        : []
    this.replacePinConstraints(topFileId, nextAssignments)
  },

  clearPinConstraints(topFileId?: string) {
    this.replacePinConstraints(topFileId ?? this.topFileId, [])
  },

  setSynthesisCache(snapshot: ProjectSynthesisCacheSnapshot | null) {
    this.synthesisCache = cloneProjectSynthesisCacheSnapshot(snapshot)
  },

  markSaved(projectPath?: string | null) {
    this.projectPath = projectPath === undefined ? this.projectPath : projectPath
    this.savedSnapshotJson = JSON.stringify(this.toSnapshot())
    this.savedFileSignatures = buildFileSignatureMap(this.files)
  },

  isFileDirty(id: string) {
    const node = this.findNode(id)
    if (!node || node.type !== 'file') {
      return false
    }

    return this.savedFileSignatures[id] !== createFileSignature(node)
  },

  // File Operations
  createFile(parentId: string, name: string) {
    const parent = this.findNode(parentId)
    if (parent && parent.type === 'folder') {
      if (!parent.children) parent.children = []
      const id = Date.now().toString()
      parent.children.push({
        id,
        name,
        type: 'file',
        content: '',
      })
      this.activeFileId = id
      this.selectedNodeId = id
      parent.isOpen = true
    }
  },

  createFolder(parentId: string, name: string) {
    const parent = this.findNode(parentId)
    if (parent && parent.type === 'folder') {
      if (!parent.children) parent.children = []
      const id = Date.now().toString()
      parent.children.push({
        id,
        name,
        type: 'folder',
        children: [],
        isOpen: true,
      })
      this.selectedNodeId = id
      parent.isOpen = true
    }
  },

  importFiles(parentId: string, files: Array<{ name: string; content: string }>) {
    const parent = this.findNode(parentId)
    if (!parent || parent.type !== 'folder' || files.length === 0) {
      return
    }

    if (!parent.children) {
      parent.children = []
    }

    const createdIds: string[] = []
    for (const [index, file] of files.entries()) {
      const id = `${Date.now()}-${index}`
      parent.children.push({
        id,
        name: file.name,
        type: 'file',
        content: file.content,
      })
      createdIds.push(id)
    }

    parent.isOpen = true

    if (!this.activeFileId && createdIds[0]) {
      this.activeFileId = createdIds[0]
    }

    if (createdIds[0]) {
      this.selectedNodeId = createdIds[0]
    }

    if (!this.topFileId) {
      this.topFileId = resolveTopFileId(this.files)
      this.pinConstraints.topFileId = this.topFileId
    }
  },

  deleteNode(id: string) {
    // Helper to remove node from tree
    const remove = (nodes: ProjectNode[]): boolean => {
      const idx = nodes.findIndex((n) => n.id === id)
      if (idx !== -1) {
        nodes.splice(idx, 1)
        return true
      }
      for (const node of nodes) {
        if (node.children && remove(node.children)) return true
      }
      return false
    }
    remove(this.files)
    if (this.activeFileId === id) {
      this.activeFileId = ''
    }
    if (this.selectedNodeId === id) {
      this.selectedNodeId = ''
    }
    if (this.topFileId === id) {
      this.topFileId = resolveTopFileId(this.files)
      this.topModuleName = ''
      this.pinConstraints = {
        version: 1,
        topFileId: this.topFileId,
        assignments: [],
      }
    }
  },

  renameNode(id: string, newName: string) {
    const node = this.findNode(id)
    if (node) {
      node.name = newName
    }
  },

  createNewProject(name: string, template: ProjectTemplate) {
    const nextProject = createProjectTemplateState(name, template)
    this.files = nextProject.files
    this.activeFileId = nextProject.activeFileId
    this.selectedNodeId = nextProject.selectedNodeId
    this.topFileId = nextProject.topFileId
    this.topModuleName = nextProject.topModuleName

    this.targetDeviceId = defaultFpgaDeviceId
    this.targetBoardId = defaultFpgaBoardId
    this.pinConstraints = {
      version: 1,
      topFileId: this.topFileId,
      assignments: [],
    }
    this.implementationSettings = cloneImplementationSettings(defaultImplementationSettings)
    this.synthesisCache = null
    virtualDeviceStore.resetState()
    this.markSaved(null)
  },

  clearProject() {
    this.files = []
    this.activeFileId = ''
    this.selectedNodeId = ''
    this.topFileId = ''
    this.topModuleName = ''
    this.targetDeviceId = defaultFpgaDeviceId
    this.targetBoardId = defaultFpgaBoardId
    this.pinConstraints = emptyProjectConstraintSnapshot()
    this.implementationSettings = cloneImplementationSettings(defaultImplementationSettings)
    this.synthesisCache = null
    virtualDeviceStore.setCanvasDevices([])
    this.markSaved(null)
  },
})

projectStore.markSaved(null)
