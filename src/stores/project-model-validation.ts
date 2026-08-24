import {
  CANVAS_DEVICE_TYPES,
  type CanvasDeviceBindingSnapshot,
  type CanvasDeviceConfigSnapshot,
  type CanvasDeviceSnapshot,
  type CanvasDeviceStateSnapshot,
  type CanvasDeviceType,
  type ImplementationReportV1,
  type SynthesisReportV1,
} from '@/lib/hardware-client'
import { sanitizeCanvasDeviceSnapshotForProject } from '@/lib/canvas-devices'
import { getDefaultFpgaBoardIdForDevice, normalizeFpgaBoardId } from '@/lib/fpga-board-catalog'
import { normalizeFpgaDeviceId } from '@/lib/fpga-device-catalog'
import { normalizeImplementationSettings } from '@/lib/implementation-settings'
import { normalizeProjectConstraintSnapshot } from '@/lib/project-constraints'
import { normalizeUniqueSignalNames, trimSignalName } from '@/lib/signal-names'

import { resolveTopFileId } from './project-model-files'
import type {
  ProjectContentSnapshot,
  ProjectImplementationCacheSnapshot,
  ProjectNode,
  ProjectSnapshot,
  ProjectSynthesisCacheSnapshot,
  ProjectWaveformViewSnapshot,
} from './project-model-types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value)
}

function normalizeWaveformColorOverrides(
  signalColorOverrides: Record<string, unknown>,
): Record<string, string> {
  const normalized: Record<string, string> = {}

  for (const [signal, color] of Object.entries(signalColorOverrides)) {
    const nextSignal = trimSignalName(signal)
    const nextColor = typeof color === 'string' ? color.trim() : ''
    if (nextSignal && nextColor) {
      normalized[nextSignal] = nextColor
    }
  }

  return normalized
}

export function emptyProjectWaveformViewSnapshot(): ProjectWaveformViewSnapshot {
  return { version: 1, signalOrder: [], signalColorOverrides: {} }
}

export function cloneProjectWaveformViewSnapshot(
  snapshot: ProjectWaveformViewSnapshot,
): ProjectWaveformViewSnapshot {
  return {
    version: 1,
    signalOrder: [...snapshot.signalOrder],
    signalColorOverrides: { ...snapshot.signalColorOverrides },
  }
}

export function normalizeProjectWaveformViewSnapshot(value: unknown): ProjectWaveformViewSnapshot {
  if (!isRecord(value) || value.version !== 1) {
    return emptyProjectWaveformViewSnapshot()
  }

  return {
    version: 1,
    signalOrder: Array.isArray(value.signalOrder)
      ? normalizeUniqueSignalNames(value.signalOrder.filter((signal) => typeof signal === 'string'))
      : [],
    signalColorOverrides: isRecord(value.signalColorOverrides)
      ? normalizeWaveformColorOverrides(value.signalColorOverrides)
      : {},
  }
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
  return snapshot
    ? {
        version: 1,
        signature: snapshot.signature,
        report: JSON.parse(JSON.stringify(snapshot.report)) as SynthesisReportV1,
      }
    : null
}

export function cloneProjectImplementationCacheSnapshot(
  snapshot: ProjectImplementationCacheSnapshot | null,
): ProjectImplementationCacheSnapshot | null {
  return snapshot
    ? {
        version: 1,
        signature: snapshot.signature,
        report: JSON.parse(JSON.stringify(snapshot.report)) as ImplementationReportV1,
      }
    : null
}

const canvasDeviceTypeSet = new Set<string>(CANVAS_DEVICE_TYPES)

function isCanvasDeviceType(value: unknown): value is CanvasDeviceType {
  return typeof value === 'string' && canvasDeviceTypeSet.has(value)
}

function isCanvasDeviceBindingSnapshot(value: unknown): value is CanvasDeviceBindingSnapshot {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false
  }
  if (value.kind === 'single') {
    return value.signal === null || typeof value.signal === 'string'
  }
  return (
    value.kind === 'slots' &&
    Array.isArray(value.signals) &&
    value.signals.every((signal) => signal === null || typeof signal === 'string')
  )
}

function hasFiniteDimensions(value: Record<string, unknown>): boolean {
  return (
    typeof value.rows === 'number' &&
    Number.isFinite(value.rows) &&
    typeof value.columns === 'number' &&
    Number.isFinite(value.columns)
  )
}

function isCanvasDeviceConfigSnapshot(value: unknown): value is CanvasDeviceConfigSnapshot {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false
  }

  switch (value.kind) {
    case 'none':
      return true
    case 'button':
      return value.active_low === undefined || typeof value.active_low === 'boolean'
    case 'segment_display':
      return (
        typeof value.digits === 'number' &&
        Number.isFinite(value.digits) &&
        (value.active_low === undefined || typeof value.active_low === 'boolean')
      )
    case 'led_matrix':
      return hasFiniteDimensions(value)
    case 'matrix_keypad':
      return (
        hasFiniteDimensions(value) &&
        (value.active_low === undefined || typeof value.active_low === 'boolean')
      )
    case 'vga_display':
      return (
        hasFiniteDimensions(value) &&
        ['mono', 'rgb111', 'rgb332', 'rgb444', 'rgb565', 'rgb888'].includes(
          String(value.color_mode),
        )
      )
    case 'dip_switch_bank':
      return typeof value.width === 'number' && Number.isFinite(value.width)
    case 'led_bar':
      return (
        typeof value.width === 'number' &&
        Number.isFinite(value.width) &&
        (value.active_low === undefined || typeof value.active_low === 'boolean')
      )
    case 'quadrature_encoder':
      return value.has_button === undefined || typeof value.has_button === 'boolean'
    case 'uart_terminal':
      return (
        typeof value.cycles_per_bit === 'number' &&
        Number.isFinite(value.cycles_per_bit) &&
        ['tx', 'rx', 'tx_rx'].includes(String(value.mode))
      )
    case 'hd44780_lcd':
      return hasFiniteDimensions(value) && ['4bit', '8bit'].includes(String(value.bus_mode))
    default:
      return false
  }
}

function isCanvasDeviceDataSnapshot(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    return false
  }

  switch (value.kind) {
    case 'none':
      return true
    case 'bitset':
      return Array.isArray(value.bits) && value.bits.every((bit) => typeof bit === 'boolean')
    case 'quadrature_encoder':
      return (
        isFiniteInteger(value.phase) &&
        value.phase >= 0 &&
        value.phase <= 3 &&
        typeof value.button_pressed === 'boolean'
      )
    case 'matrix_keypad':
      return (
        (value.pressed_row === null && value.pressed_column === null) ||
        (isFiniteInteger(value.pressed_row) &&
          value.pressed_row >= 0 &&
          isFiniteInteger(value.pressed_column) &&
          value.pressed_column >= 0)
      )
    case 'queued_bytes':
      return (
        Array.isArray(value.bytes) &&
        value.bytes.every((byte) => isFiniteInteger(byte) && byte >= 0 && byte <= 255)
      )
    default:
      return false
  }
}

function isCanvasDeviceStateSnapshot(value: unknown): value is CanvasDeviceStateSnapshot {
  return (
    isRecord(value) &&
    typeof value.is_on === 'boolean' &&
    (value.color === null || typeof value.color === 'string') &&
    isCanvasDeviceBindingSnapshot(value.binding) &&
    isCanvasDeviceConfigSnapshot(value.config) &&
    isCanvasDeviceDataSnapshot(value.data)
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

export function cloneProjectCanvasDevices(
  devices: readonly CanvasDeviceSnapshot[] = [],
): CanvasDeviceSnapshot[] {
  return devices.map((device) => sanitizeCanvasDeviceSnapshotForProject(device))
}

export function normalizeProjectCanvasDevices(value: unknown): CanvasDeviceSnapshot[] {
  return Array.isArray(value) ? cloneProjectCanvasDevices(value.filter(isCanvasDeviceSnapshot)) : []
}

function isProjectNode(value: unknown): value is ProjectNode {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') {
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
  return (
    value.children === undefined ||
    (Array.isArray(value.children) && value.children.every(isProjectNode))
  )
}

function isSynthesisReport(value: unknown): value is SynthesisReportV1 {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.op_id === 'string' &&
    typeof value.success === 'boolean' &&
    typeof value.top_module === 'string' &&
    typeof value.source_count === 'number' &&
    typeof value.tool_path === 'string' &&
    typeof value.elapsed_ms === 'number' &&
    typeof value.warnings === 'number' &&
    typeof value.errors === 'number' &&
    typeof value.log === 'string' &&
    isRecord(value.stats) &&
    Array.isArray(value.top_ports) &&
    typeof value.generated_at_ms === 'number'
  )
}

function isImplementationReport(value: unknown): value is ImplementationReportV1 {
  return (
    isRecord(value) &&
    value.version === 1 &&
    typeof value.op_id === 'string' &&
    typeof value.success === 'boolean' &&
    typeof value.timing_success === 'boolean' &&
    typeof value.top_module === 'string' &&
    typeof value.source_count === 'number' &&
    typeof value.elapsed_ms === 'number' &&
    typeof value.log === 'string' &&
    Array.isArray(value.stages) &&
    isRecord(value.artifacts) &&
    typeof value.timing_report === 'string' &&
    typeof value.generated_at_ms === 'number'
  )
}

export function normalizeProjectSynthesisCacheSnapshot(
  value: unknown,
): ProjectSynthesisCacheSnapshot | null {
  if (
    !isRecord(value) ||
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

export function normalizeProjectImplementationCacheSnapshot(
  value: unknown,
): ProjectImplementationCacheSnapshot | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.signature !== 'string' ||
    !isImplementationReport(value.report)
  ) {
    return null
  }
  return cloneProjectImplementationCacheSnapshot({
    version: 1,
    signature: value.signature,
    report: value.report,
  })
}

export function normalizeProjectSnapshot(value: unknown): ProjectSnapshot {
  if (!isRecord(value)) throw new Error('Invalid project file format')
  if (value.version !== 2) throw new Error('Unsupported project file version')
  if (!isRecord(value.content)) throw new Error('Project content snapshot is missing')
  if (!isRecord(value.workspaceView)) throw new Error('Project workspace view snapshot is missing')
  if (typeof value.content.name !== 'string') throw new Error('Project name is missing')
  if (typeof value.workspaceView.activeFileId !== 'string') {
    throw new Error('Active file id is missing')
  }
  if (!Array.isArray(value.content.files) || !value.content.files.every(isProjectNode)) {
    throw new Error('Project files are invalid')
  }

  const normalizedTargetDeviceId = normalizeFpgaDeviceId(value.content.targetDeviceId)
  const resolvedTopFileId =
    typeof value.content.topFileId === 'string' && value.content.topFileId.length > 0
      ? value.content.topFileId
      : resolveTopFileId(value.content.files)
  const content: ProjectContentSnapshot = {
    name: value.content.name,
    files: cloneProjectNodes(value.content.files),
    topFileId: resolvedTopFileId,
    topModuleName:
      typeof value.content.topModuleName === 'string' ? value.content.topModuleName : '',
    targetDeviceId: normalizedTargetDeviceId,
    targetBoardId: normalizeFpgaBoardId(
      value.content.targetBoardId,
      getDefaultFpgaBoardIdForDevice(normalizedTargetDeviceId),
    ),
    pinConstraints: normalizeProjectConstraintSnapshot(
      value.content.pinConstraints,
      resolvedTopFileId,
    ),
    implementationSettings: normalizeImplementationSettings(value.content.implementationSettings),
    synthesisCache: normalizeProjectSynthesisCacheSnapshot(value.content.synthesisCache),
    implementationCache: normalizeProjectImplementationCacheSnapshot(
      value.content.implementationCache,
    ),
    canvasDevices: normalizeProjectCanvasDevices(value.content.canvasDevices),
    waveformView: normalizeProjectWaveformViewSnapshot(value.content.waveformView),
  }

  return {
    version: 2,
    content,
    workspaceView: { activeFileId: value.workspaceView.activeFileId },
  }
}
