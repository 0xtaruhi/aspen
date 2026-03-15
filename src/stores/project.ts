import { reactive } from 'vue'

import {
  defaultFpgaDeviceId,
  normalizeFpgaDeviceId,
  type FpgaDeviceId,
} from '../lib/fpga-device-catalog'
import {
  defaultFpgaBoardId,
  getDefaultFpgaBoardIdForDevice,
  normalizeFpgaBoardId,
  type FpgaBoardId,
} from '../lib/fpga-board-catalog'
import {
  cloneProjectConstraintSnapshot,
  emptyProjectConstraintSnapshot,
  normalizeProjectConstraintSnapshot,
  type ProjectConstraintSnapshot,
  type ProjectPinConstraint,
} from '../lib/project-constraints'
import { parseVerilogPorts, type VerilogPort } from '../lib/verilog-parser'

export type ProjectNode = {
  id: string
  name: string
  type: 'file' | 'folder'
  content?: string // Only for files
  children?: ProjectNode[] // Only for folders
  isOpen?: boolean // For UI state
}

export type ProjectSnapshot = {
  version: 1
  name: string
  files: ProjectNode[]
  activeFileId: string
  topFileId: string
  topModuleName: string
  targetDeviceId: FpgaDeviceId
  targetBoardId: FpgaBoardId
  pinConstraints: ProjectConstraintSnapshot
}

type FileSignatureMap = Record<string, string>

function cloneProjectNodes(nodes: ProjectNode[]): ProjectNode[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    content: node.content,
    isOpen: node.isOpen,
    children: node.children ? cloneProjectNodes(node.children) : undefined,
  }))
}

function createFileSignature(node: ProjectNode): string {
  return `${node.name}\n${node.content ?? ''}`
}

function buildFileSignatureMap(
  nodes: ProjectNode[],
  signatureMap: FileSignatureMap = {},
): FileSignatureMap {
  for (const node of nodes) {
    if (node.type === 'file') {
      signatureMap[node.id] = createFileSignature(node)
    }

    if (node.children) {
      buildFileSignatureMap(node.children, signatureMap)
    }
  }

  return signatureMap
}

function findFirstFileId(nodes: ProjectNode[]): string {
  for (const node of nodes) {
    if (node.type === 'file') {
      return node.id
    }
    if (node.children) {
      const childFileId = findFirstFileId(node.children)
      if (childFileId) {
        return childFileId
      }
    }
  }
  return ''
}

function isHardwareSourceFile(name: string): boolean {
  return name.endsWith('.v') || name.endsWith('.sv')
}

function findFirstMatchingFileId(
  nodes: ProjectNode[],
  predicate: (node: ProjectNode) => boolean,
): string {
  for (const node of nodes) {
    if (node.type === 'file' && predicate(node)) {
      return node.id
    }
    if (node.children) {
      const childFileId = findFirstMatchingFileId(node.children, predicate)
      if (childFileId) {
        return childFileId
      }
    }
  }

  return ''
}

function resolveTopFileId(nodes: ProjectNode[]): string {
  const topNamedHardwareFileId = findFirstMatchingFileId(nodes, (node) => {
    return isHardwareSourceFile(node.name) && /^top([._-]|$)/i.test(node.name)
  })
  if (topNamedHardwareFileId) {
    return topNamedHardwareFileId
  }

  const firstHardwareFileId = findFirstMatchingFileId(nodes, (node) => {
    return isHardwareSourceFile(node.name)
  })
  if (firstHardwareFileId) {
    return firstHardwareFileId
  }

  return findFirstFileId(nodes)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProjectNode(value: unknown): value is ProjectNode {
  if (!isRecord(value)) {
    return false
  }

  if (typeof value.id !== 'string' || typeof value.name !== 'string') {
    return false
  }

  if (value.type !== 'file' && value.type !== 'folder') {
    return false
  }

  if (value.content !== undefined && typeof value.content !== 'string') {
    return false
  }

  if (value.isOpen !== undefined && typeof value.isOpen !== 'boolean') {
    return false
  }

  if (value.children !== undefined) {
    if (!Array.isArray(value.children)) {
      return false
    }
    if (!value.children.every(isProjectNode)) {
      return false
    }
  }

  return true
}

function normalizeSnapshot(value: unknown): ProjectSnapshot {
  if (!isRecord(value)) {
    throw new Error('Invalid project file format')
  }

  if (value.version !== 1) {
    throw new Error('Unsupported project file version')
  }

  if (typeof value.name !== 'string') {
    throw new Error('Project name is missing')
  }

  if (typeof value.activeFileId !== 'string') {
    throw new Error('Active file id is missing')
  }

  if (!Array.isArray(value.files) || !value.files.every(isProjectNode)) {
    throw new Error('Project files are invalid')
  }

  const normalizedTargetDeviceId = normalizeFpgaDeviceId(value.targetDeviceId)
  const resolvedTopFileId =
    typeof value.topFileId === 'string' && value.topFileId.length > 0
      ? value.topFileId
      : resolveTopFileId(value.files)

  return {
    version: 1,
    name: value.name,
    files: cloneProjectNodes(value.files),
    activeFileId: value.activeFileId,
    topFileId: resolvedTopFileId,
    topModuleName: typeof value.topModuleName === 'string' ? value.topModuleName : '',
    targetDeviceId: normalizedTargetDeviceId,
    targetBoardId: normalizeFpgaBoardId(
      value.targetBoardId,
      getDefaultFpgaBoardIdForDevice(normalizedTargetDeviceId),
    ),
    pinConstraints: normalizeProjectConstraintSnapshot(value.pinConstraints, resolvedTopFileId),
  }
}

export const projectStore = reactive({
  files: [] as ProjectNode[],

  activeFileId: '',
  selectedNodeId: '',
  topFileId: '',
  topModuleName: '',
  targetDeviceId: defaultFpgaDeviceId,
  targetBoardId: defaultFpgaBoardId,
  pinConstraints: emptyProjectConstraintSnapshot(),
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
    if (this.topFile?.type === 'file' && isHardwareSourceFile(this.topFile.name)) {
      return parseVerilogPorts(this.topFile.content || '')
    }
    return [] as VerilogPort[]
  },

  get signals() {
    if (this.activeFile?.name.endsWith('.v')) {
      return parseVerilogPorts(this.activeFile.content || '')
    }
    return [] as VerilogPort[]
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
    }
  },

  loadFromSnapshot(snapshot: unknown, options: { projectPath?: string | null } = {}) {
    const parsed = normalizeSnapshot(snapshot)
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

  createNewProject(name: string, template: 'empty' | 'blinky' | 'uart') {
    // Reset files to a new structure based on template
    this.files = [
      {
        id: 'root',
        name: name || 'src',
        type: 'folder',
        isOpen: true,
        children: [],
      },
    ]

    if (template === 'blinky') {
      this.files[0].children?.push({
        id: '1',
        name: 'blinky.v',
        type: 'file',
        content: `module blinky(
    input clk,
    output reg led
);
    reg [25:0] count;
    always @(posedge clk) begin
        count <= count + 1;
        if (count == 0) led <= ~led;
    end
endmodule`,
      })
      this.activeFileId = '1'
      this.selectedNodeId = '1'
      this.topFileId = '1'
      this.topModuleName = 'blinky'
    } else if (template === 'uart') {
      this.files[0].children?.push({
        id: '1',
        name: 'uart_tx.v',
        type: 'file',
        content: `module uart_tx #(
    parameter CLK_FREQ = 50_000_000,
    parameter BAUD_RATE = 115_200
)(
    input wire clk,
    input wire rst,
    input wire tx_start,
    input wire [7:0] tx_data,
    output reg tx,
    output reg busy
);
    localparam integer CLKS_PER_BIT = CLK_FREQ / BAUD_RATE;
    reg [15:0] clk_count;
    reg [3:0] bit_index;
    reg [9:0] shift_reg;

    always @(posedge clk) begin
        if (rst) begin
            tx <= 1'b1;
            busy <= 1'b0;
            clk_count <= 0;
            bit_index <= 0;
            shift_reg <= 10'b1111111111;
        end else if (!busy && tx_start) begin
            busy <= 1'b1;
            shift_reg <= {1'b1, tx_data, 1'b0};
            clk_count <= 0;
            bit_index <= 0;
        end else if (busy) begin
            if (clk_count == CLKS_PER_BIT - 1) begin
                clk_count <= 0;
                tx <= shift_reg[0];
                shift_reg <= {1'b1, shift_reg[9:1]};
                bit_index <= bit_index + 1;
                if (bit_index == 9) begin
                    busy <= 1'b0;
                end
            end else begin
                clk_count <= clk_count + 1;
            end
        end
    end
endmodule`,
      })
      this.activeFileId = '1'
      this.selectedNodeId = '1'
      this.topFileId = '1'
      this.topModuleName = 'uart_tx'
    } else {
      this.activeFileId = ''
      this.selectedNodeId = ''
      this.topFileId = ''
      this.topModuleName = ''
    }

    this.targetDeviceId = defaultFpgaDeviceId
    this.targetBoardId = defaultFpgaBoardId
    this.pinConstraints = {
      version: 1,
      topFileId: this.topFileId,
      assignments: [],
    }
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
    this.markSaved(null)
  },
})

projectStore.markSaved(null)
