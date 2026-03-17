import type {
  CanvasDeviceBindingSnapshot,
  CanvasDeviceConfigSnapshot,
  CanvasDeviceSnapshot,
  CanvasDeviceStateSnapshot,
  CanvasDeviceType,
  SynthesisReportV1,
} from '../lib/hardware-client'

import { normalizeFpgaDeviceId, type FpgaDeviceId } from '../lib/fpga-device-catalog'
import {
  getDefaultFpgaBoardIdForDevice,
  normalizeFpgaBoardId,
  type FpgaBoardId,
} from '../lib/fpga-board-catalog'
import {
  normalizeProjectConstraintSnapshot,
  type ProjectConstraintSnapshot,
} from '../lib/project-constraints'
import {
  normalizeImplementationSettings,
  type ImplementationSettingsSnapshot,
} from '../lib/implementation-settings'
import { parseVerilogPorts, type VerilogPort } from '../lib/verilog-parser'

export type ProjectNode = {
  id: string
  name: string
  type: 'file' | 'folder'
  content?: string
  children?: ProjectNode[]
  isOpen?: boolean
}

export type ProjectSynthesisCacheSnapshot = {
  version: 1
  signature: string
  report: SynthesisReportV1
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
  implementationSettings: ImplementationSettingsSnapshot
  synthesisCache: ProjectSynthesisCacheSnapshot | null
  canvasDevices: CanvasDeviceSnapshot[]
}

export type FileSignatureMap = Record<string, string>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isHardwareSourceFile(name: string) {
  return name.endsWith('.v') || name.endsWith('.sv')
}

export function cloneProjectNodes(nodes: ProjectNode[]): ProjectNode[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    type: node.type,
    content: node.content,
    isOpen: node.isOpen,
    children: node.children ? cloneProjectNodes(node.children) : undefined,
  }))
}

export function cloneProjectSynthesisCacheSnapshot(
  snapshot: ProjectSynthesisCacheSnapshot | null,
): ProjectSynthesisCacheSnapshot | null {
  if (!snapshot) {
    return null
  }

  return {
    version: 1,
    signature: snapshot.signature,
    report: JSON.parse(JSON.stringify(snapshot.report)) as SynthesisReportV1,
  }
}

function isCanvasDeviceType(value: unknown): value is CanvasDeviceType {
  return (
    value === 'led' ||
    value === 'switch' ||
    value === 'button' ||
    value === 'keypad' ||
    value === 'small_keypad' ||
    value === 'rotary_button' ||
    value === 'ps2_keyboard' ||
    value === 'text_lcd' ||
    value === 'graphic_lcd' ||
    value === 'segment_display' ||
    value === 'led_matrix'
  )
}

function isCanvasDeviceBindingSnapshot(value: unknown): value is CanvasDeviceBindingSnapshot {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false
  }

  if (value.kind === 'single') {
    return value.signal === null || typeof value.signal === 'string'
  }

  if (value.kind === 'slots') {
    return (
      Array.isArray(value.signals) &&
      value.signals.every((signal) => signal === null || typeof signal === 'string')
    )
  }

  return false
}

function isCanvasDeviceConfigSnapshot(value: unknown): value is CanvasDeviceConfigSnapshot {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false
  }

  if (value.kind === 'none') {
    return true
  }

  if (value.kind === 'button') {
    return value.active_low === undefined || typeof value.active_low === 'boolean'
  }

  if (value.kind === 'segment_display') {
    return (
      typeof value.digits === 'number' &&
      Number.isFinite(value.digits) &&
      (value.active_low === undefined || typeof value.active_low === 'boolean')
    )
  }

  if (value.kind === 'led_matrix') {
    return (
      typeof value.rows === 'number' &&
      Number.isFinite(value.rows) &&
      typeof value.columns === 'number' &&
      Number.isFinite(value.columns)
    )
  }

  return false
}

function isCanvasDeviceStateSnapshot(value: unknown): value is CanvasDeviceStateSnapshot {
  return (
    isRecord(value) &&
    typeof value.is_on === 'boolean' &&
    (value.color === null || typeof value.color === 'string') &&
    isCanvasDeviceBindingSnapshot(value.binding) &&
    isCanvasDeviceConfigSnapshot(value.config)
  )
}

function isCanvasDeviceSnapshot(value: unknown): value is CanvasDeviceSnapshot {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isCanvasDeviceType(value.type) &&
    typeof value.x === 'number' &&
    Number.isFinite(value.x) &&
    typeof value.y === 'number' &&
    Number.isFinite(value.y) &&
    typeof value.label === 'string' &&
    isCanvasDeviceStateSnapshot(value.state)
  )
}

function cloneCanvasDeviceBindingSnapshot(
  binding: CanvasDeviceBindingSnapshot,
): CanvasDeviceBindingSnapshot {
  return binding.kind === 'single'
    ? {
        kind: 'single',
        signal: binding.signal ?? null,
      }
    : {
        kind: 'slots',
        signals: [...binding.signals],
      }
}

function cloneCanvasDeviceConfigSnapshot(
  config: CanvasDeviceConfigSnapshot,
): CanvasDeviceConfigSnapshot {
  if (config.kind === 'button') {
    return {
      kind: 'button',
      active_low: config.active_low ?? false,
    }
  }

  if (config.kind === 'segment_display') {
    return {
      kind: 'segment_display',
      digits: config.digits,
      active_low: config.active_low ?? false,
    }
  }

  if (config.kind === 'led_matrix') {
    return {
      kind: 'led_matrix',
      rows: config.rows,
      columns: config.columns,
    }
  }

  return {
    kind: 'none',
  }
}

function cloneCanvasDeviceStateSnapshot(
  state: CanvasDeviceStateSnapshot,
): CanvasDeviceStateSnapshot {
  return {
    is_on: state.is_on,
    color: state.color ?? null,
    binding: cloneCanvasDeviceBindingSnapshot(state.binding),
    config: cloneCanvasDeviceConfigSnapshot(state.config),
  }
}

export function cloneProjectCanvasDevices(
  devices: readonly CanvasDeviceSnapshot[] = [],
): CanvasDeviceSnapshot[] {
  return devices.map((device) => ({
    id: device.id,
    type: device.type,
    x: device.x,
    y: device.y,
    label: device.label,
    state: cloneCanvasDeviceStateSnapshot(device.state),
  }))
}

export function normalizeProjectCanvasDevices(value: unknown): CanvasDeviceSnapshot[] {
  if (!Array.isArray(value)) {
    return []
  }

  return cloneProjectCanvasDevices(value.filter(isCanvasDeviceSnapshot))
}

export function createFileSignature(node: ProjectNode) {
  return `${node.name}\n${node.content ?? ''}`
}

export function buildFileSignatureMap(
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

export function findFirstFileId(nodes: ProjectNode[]): string {
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

export function resolveTopFileId(nodes: ProjectNode[]): string {
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

export function parseTopSignals(topFile: ProjectNode | null): VerilogPort[] {
  if (topFile?.type === 'file' && isHardwareSourceFile(topFile.name)) {
    return parseVerilogPorts(topFile.content || '')
  }

  return []
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

function isSynthesisReport(value: unknown): value is SynthesisReportV1 {
  if (!isRecord(value)) {
    return false
  }

  if (
    value.version !== 1 ||
    typeof value.op_id !== 'string' ||
    typeof value.success !== 'boolean' ||
    typeof value.top_module !== 'string' ||
    typeof value.source_count !== 'number' ||
    typeof value.tool_path !== 'string' ||
    typeof value.elapsed_ms !== 'number' ||
    typeof value.warnings !== 'number' ||
    typeof value.errors !== 'number' ||
    typeof value.log !== 'string' ||
    !isRecord(value.stats) ||
    !Array.isArray(value.top_ports) ||
    typeof value.generated_at_ms !== 'number'
  ) {
    return false
  }

  return true
}

export function normalizeProjectSynthesisCacheSnapshot(
  value: unknown,
): ProjectSynthesisCacheSnapshot | null {
  if (!isRecord(value)) {
    return null
  }

  if (
    value.version !== 1 ||
    typeof value.signature !== 'string' ||
    !isSynthesisReport(value.report)
  ) {
    return null
  }

  return cloneProjectSynthesisCacheSnapshot({
    version: 1,
    signature: value.signature,
    report: value.report,
  })
}

export function normalizeProjectSnapshot(value: unknown): ProjectSnapshot {
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
    implementationSettings: normalizeImplementationSettings(value.implementationSettings),
    synthesisCache: normalizeProjectSynthesisCacheSnapshot(value.synthesisCache),
    canvasDevices: normalizeProjectCanvasDevices(value.canvasDevices),
  }
}
