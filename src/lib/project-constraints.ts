import type { ExpandedVerilogPortBit } from './verilog-port-bits'
import type {
  FpgaBoardDescriptor,
  FpgaBoardPinDescriptor,
  FpgaBoardPinRole,
} from './fpga-board-catalog'

export type ProjectPinConstraint = {
  portName: string
  pinId: string
  ioStandard?: string | null
  pull?: 'none' | 'up' | 'down' | null
  drive?: number | null
  slew?: 'slow' | 'fast' | null
  clockPeriodNs?: number | null
  boardFunction?: string | null
}

export type ProjectConstraintSnapshot = {
  version: 1
  topFileId: string
  assignments: ProjectPinConstraint[]
}

export const emptyProjectConstraintSnapshot = (): ProjectConstraintSnapshot => ({
  version: 1,
  topFileId: '',
  assignments: [],
})

const maybeClockNames = ['clk', 'clock', 'clk_in', 'clock_in', 'clk_i', 'clock_i']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isProjectPinConstraint(value: unknown): value is ProjectPinConstraint {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.portName === 'string' && typeof value.pinId === 'string'
}

export function normalizeProjectConstraintSnapshot(
  value: unknown,
  fallbackTopFileId = '',
): ProjectConstraintSnapshot {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.assignments)) {
    return {
      ...emptyProjectConstraintSnapshot(),
      topFileId: fallbackTopFileId,
    }
  }

  const assignments = value.assignments.filter(isProjectPinConstraint).map((entry) => ({
    portName: entry.portName,
    pinId: entry.pinId,
    ioStandard: entry.ioStandard ?? null,
    pull: entry.pull ?? null,
    drive: entry.drive ?? null,
    slew: entry.slew ?? null,
    clockPeriodNs: entry.clockPeriodNs ?? null,
    boardFunction: entry.boardFunction ?? null,
  }))

  return {
    version: 1,
    topFileId: typeof value.topFileId === 'string' ? value.topFileId : fallbackTopFileId,
    assignments,
  }
}

export function cloneProjectConstraintSnapshot(
  snapshot: ProjectConstraintSnapshot,
): ProjectConstraintSnapshot {
  return {
    version: 1,
    topFileId: snapshot.topFileId,
    assignments: snapshot.assignments.map((entry) => ({
      ...entry,
    })),
  }
}

export function buildConstraintAssignmentMap(assignments: readonly ProjectPinConstraint[]) {
  return new Map(assignments.map((entry) => [entry.portName, entry]))
}

export function isLikelyClockPort(name: string) {
  const normalized = name.trim().toLowerCase()
  return maybeClockNames.includes(normalized)
}

export function getCompatiblePinRoles(
  direction: ExpandedVerilogPortBit['direction'],
  bitName: string,
): FpgaBoardPinRole[] {
  if (direction === 'output') {
    return ['output']
  }

  if (direction === 'inout') {
    return ['input', 'output']
  }

  return isLikelyClockPort(bitName) ? ['clock', 'input'] : ['input', 'clock']
}

export function getCompatibleBoardPins(
  board: FpgaBoardDescriptor,
  port: Pick<ExpandedVerilogPortBit, 'direction' | 'bitName'>,
): FpgaBoardPinDescriptor[] {
  const compatibleRoles = getCompatiblePinRoles(port.direction, port.bitName)
  return compatibleRoles.flatMap((role) => {
    return board.pins.filter((pin) => pin.role === role)
  })
}

export function filterAssignmentsForPorts(
  assignments: readonly ProjectPinConstraint[],
  ports: readonly ExpandedVerilogPortBit[],
): ProjectPinConstraint[] {
  const portNames = new Set(ports.map((port) => port.bitName))
  return assignments.filter((entry) => portNames.has(entry.portName))
}

export function resolveCurrentProjectPinConstraints(
  snapshot: ProjectConstraintSnapshot,
  currentTopFileId: string,
  ports: readonly ExpandedVerilogPortBit[],
): ProjectPinConstraint[] {
  if (!currentTopFileId || snapshot.topFileId !== currentTopFileId) {
    return []
  }

  return filterAssignmentsForPorts(snapshot.assignments, ports)
}

export function buildPhysicalSignalSlotOrder(
  board: FpgaBoardDescriptor,
  assignments: readonly ProjectPinConstraint[],
  role: FpgaBoardPinRole,
): string[] {
  const pinToPortName = new Map(assignments.map((entry) => [entry.pinId, entry.portName.trim()]))

  return board.pins.filter((pin) => pin.role === role).map((pin) => pinToPortName.get(pin.id) ?? '')
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function buildConstraintXml(
  designName: string,
  assignments: readonly ProjectPinConstraint[],
): string {
  const normalizedName = designName.trim() || 'top'
  const lines = assignments.map((assignment) => {
    return `  <port name="${escapeXml(assignment.portName)}" position="${escapeXml(assignment.pinId)}"/>`
  })

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<design name="${escapeXml(normalizedName)}">`,
    ...lines,
    '</design>',
    '',
  ].join('\n')
}

export function autoAssignProjectConstraints(
  ports: readonly ExpandedVerilogPortBit[],
  board: FpgaBoardDescriptor,
): ProjectPinConstraint[] {
  const assignments: ProjectPinConstraint[] = []
  const usedPins = new Set<string>()

  for (const port of ports) {
    const nextPin = getCompatibleBoardPins(board, port).find((pin) => !usedPins.has(pin.id))
    if (!nextPin) {
      continue
    }

    assignments.push({
      portName: port.bitName,
      pinId: nextPin.id,
      boardFunction: nextPin.boardFunction,
    })
    usedPins.add(nextPin.id)
  }

  return assignments
}
