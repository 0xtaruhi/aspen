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
} from '../lib/implementation-settings'
import {
  buildFileSignatureMap,
  cloneProjectCanvasDevices,
  cloneProjectImplementationCacheSnapshot,
  cloneProjectNodes,
  cloneProjectSynthesisCacheSnapshot,
  createFileSignature,
  findFirstFileId,
  isHardwareSourceFile,
  normalizeProjectSnapshot,
  parseTopSignals,
  resolveTopFileId,
  type FileSignatureMap,
  type ProjectImplementationCacheSnapshot,
  type ProjectNode,
  type ProjectSnapshot,
  type ProjectSynthesisCacheSnapshot,
} from './project-model'
import { projectCanvasStore } from './project-canvas'
import { createProjectTemplateState, type ProjectTemplate } from './project-templates'

export type {
  ProjectImplementationCacheSnapshot,
  ProjectNode,
  ProjectSnapshot,
  ProjectSynthesisCacheSnapshot,
} from './project-model'

type ProjectNodeLocation = {
  node: ProjectNode
  parent: ProjectNode | null
  container: ProjectNode[]
  index: number
}

function findNodeLocationInTree(
  id: string,
  nodes: ProjectNode[],
  parent: ProjectNode | null = null,
): ProjectNodeLocation | null {
  for (const [index, node] of nodes.entries()) {
    if (node.id === id) {
      return {
        node,
        parent,
        container: nodes,
        index,
      }
    }
    if (node.children) {
      const found = findNodeLocationInTree(id, node.children, node)
      if (found) {
        return found
      }
    }
  }

  return null
}

function nodeContainsDescendantId(node: ProjectNode, descendantId: string): boolean {
  if (!node.children) {
    return false
  }

  for (const child of node.children) {
    if (child.id === descendantId || nodeContainsDescendantId(child, descendantId)) {
      return true
    }
  }

  return false
}

function clampInsertionIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) {
    return length
  }

  return Math.max(0, Math.min(length, Math.trunc(index)))
}

export const projectStore = reactive({
  sessionId: 0,
  files: [] as ProjectNode[],

  activeFileId: '',
  selectedNodeId: '',
  renamingNodeId: '',
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
    const parsed = normalizeProjectSnapshot(snapshot)
    const nextFiles = cloneProjectNodes(parsed.files)
    const nextActiveFileId = this.findNode(parsed.activeFileId, nextFiles)
      ? parsed.activeFileId
      : findFirstFileId(nextFiles)
    const nextTopFileId = this.findNode(parsed.topFileId, nextFiles)
      ? parsed.topFileId
      : resolveTopFileId(nextFiles)
    const nextPinConstraints = cloneProjectConstraintSnapshot(parsed.pinConstraints)
    const resolvedConstraintTarget = nextPinConstraints.topFileId
      ? this.findNode(nextPinConstraints.topFileId, nextFiles)
      : null
    if ((!resolvedConstraintTarget || resolvedConstraintTarget.type !== 'file') && nextTopFileId) {
      nextPinConstraints.topFileId = nextTopFileId
    }

    this.files = nextFiles
    this.activeFileId = nextActiveFileId
    this.selectedNodeId = nextActiveFileId
    this.renamingNodeId = ''
    this.topFileId = nextTopFileId
    this.topModuleName = parsed.topFileId === nextTopFileId ? parsed.topModuleName : ''
    this.targetDeviceId = parsed.targetDeviceId
    this.targetBoardId = parsed.targetBoardId
    this.pinConstraints = nextPinConstraints
    this.implementationSettings = cloneImplementationSettings(parsed.implementationSettings)
    this.synthesisCache = cloneProjectSynthesisCacheSnapshot(parsed.synthesisCache)
    this.implementationCache = cloneProjectImplementationCacheSnapshot(parsed.implementationCache)
    projectCanvasStore.setCanvasDevices(parsed.canvasDevices)
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

  beginRenamingNode(id: string) {
    if (!this.findNode(id)) {
      return
    }

    this.selectedNodeId = id
    this.renamingNodeId = id
  },

  cancelRenamingNode(id?: string) {
    if (!id || this.renamingNodeId === id) {
      this.renamingNodeId = ''
    }
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

  setImplementationCache(snapshot: ProjectImplementationCacheSnapshot | null) {
    this.implementationCache = cloneProjectImplementationCacheSnapshot(snapshot)
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
    if (this.renamingNodeId === id) {
      this.renamingNodeId = ''
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

  commitNodeRename(id: string, newName: string) {
    const trimmedName = newName.trim()
    const node = this.findNode(id)
    if (!node) {
      this.cancelRenamingNode(id)
      return false
    }

    this.renamingNodeId = ''
    if (!trimmedName || trimmedName === node.name) {
      return false
    }

    node.name = trimmedName
    return true
  },

  moveNode(id: string, targetParentId: string | null, targetIndex: number) {
    const source = this.findNodeLocation(id)
    if (!source) {
      return false
    }

    const targetParent = targetParentId ? this.findNode(targetParentId) : null
    if (targetParent && targetParent.type !== 'folder') {
      return false
    }

    if (targetParent && source.node.type === 'folder') {
      if (
        targetParent.id === source.node.id ||
        nodeContainsDescendantId(source.node, targetParent.id)
      ) {
        return false
      }
    }

    const targetContainer = targetParent ? (targetParent.children ??= []) : this.files
    let insertionIndex = clampInsertionIndex(targetIndex, targetContainer.length)

    if (source.container === targetContainer) {
      if (source.index === insertionIndex || source.index + 1 === insertionIndex) {
        return true
      }
      if (source.index < insertionIndex) {
        insertionIndex -= 1
      }
    }

    const [movedNode] = source.container.splice(source.index, 1)
    if (!movedNode) {
      return false
    }

    targetContainer.splice(insertionIndex, 0, movedNode)

    if (targetParent) {
      targetParent.isOpen = true
    }

    return true
  },

  createNewProject(name: string, template: ProjectTemplate) {
    const nextProject = createProjectTemplateState(name, template)
    this.files = nextProject.files
    this.activeFileId = nextProject.activeFileId
    this.selectedNodeId = nextProject.selectedNodeId
    this.renamingNodeId = ''
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
    this.implementationCache = null
    projectCanvasStore.resetState()
    this.sessionId += 1
    this.markSaved(null)
  },

  clearProject() {
    this.files = []
    this.activeFileId = ''
    this.selectedNodeId = ''
    this.renamingNodeId = ''
    this.topFileId = ''
    this.topModuleName = ''
    this.targetDeviceId = defaultFpgaDeviceId
    this.targetBoardId = defaultFpgaBoardId
    this.pinConstraints = emptyProjectConstraintSnapshot()
    this.implementationSettings = cloneImplementationSettings(defaultImplementationSettings)
    this.synthesisCache = null
    this.implementationCache = null
    projectCanvasStore.setCanvasDevices([])
    this.sessionId += 1
    this.markSaved(null)
  },
})

projectStore.markSaved(null)
