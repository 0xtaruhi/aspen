import type { ExpandedVerilogPortBit } from '@/lib/verilog-port-bits'
import type { FpgaBoardPinRole } from '@/lib/fpga-board-catalog'

import { computed, readonly } from 'vue'

import { getFpgaBoardDescriptor } from '@/lib/fpga-board-catalog'
import {
  buildPhysicalSignalSlotOrder,
  resolveCurrentProjectPinConstraints,
} from '@/lib/project-constraints'
import { expandVerilogPorts } from '@/lib/verilog-port-bits'
import { projectStore } from '@/stores/project'
import { synthesisCatalogStore } from '@/stores/synthesis-catalog'

export type SignalCatalogEntry = ExpandedVerilogPortBit & {
  name: string
  assignedPin: string | null
  assignedPinRole: FpgaBoardPinRole | null
  boardFunction: string | null
  bindingLabel: string
}

function buildBindingLabel(signal: {
  bitName: string
  assignedPin: string | null
  boardFunction: string | null
}) {
  const parts = [signal.bitName]
  if (signal.assignedPin) {
    parts.push(signal.assignedPin)
  }
  if (signal.boardFunction) {
    parts.push(signal.boardFunction)
  }
  return parts.join(' · ')
}

const signals = computed<readonly SignalCatalogEntry[]>(() => {
  const report = signalSourceReport.value
  if (!report?.success) {
    return []
  }

  const expandedSignals = expandedSignalBits.value
  const assignments = currentConstraintAssignments.value
  const assignmentMap = new Map(assignments.map((entry) => [entry.portName, entry]))
  const board = targetBoard.value

  return expandedSignals.map((signal) => {
    const assignment = assignmentMap.get(signal.bitName)
    const boardPin = assignment ? board.pins.find((pin) => pin.id === assignment.pinId) : null
    const assignedPin = assignment?.pinId ?? null
    const boardFunction = assignment?.boardFunction ?? boardPin?.boardFunction ?? null

    return {
      ...signal,
      name: signal.bitName,
      assignedPin,
      assignedPinRole: boardPin?.role ?? null,
      boardFunction,
      bindingLabel: buildBindingLabel({
        bitName: signal.bitName,
        assignedPin,
        boardFunction,
      }),
    }
  })
})

const workbenchSignals = computed<readonly SignalCatalogEntry[]>(() => {
  return signals.value.filter((signal) => signal.assignedPinRole !== 'clock')
})

const targetBoard = computed(() => getFpgaBoardDescriptor(projectStore.targetBoardId))

const signalSourceReport = computed(() => {
  return (
    synthesisCatalogStore.currentSuccessfulSynthesisReport.value ??
    synthesisCatalogStore.latestSuccessfulSynthesisReport.value
  )
})

const hasSignalSourceReport = computed(() => {
  return Boolean(signalSourceReport.value)
})

const hasStaleSignalSourceReport = computed(() => {
  return synthesisCatalogStore.hasStaleSuccessfulSynthesisReport.value
})

const expandedSignalBits = computed(() => {
  const report = signalSourceReport.value
  return report?.success ? expandVerilogPorts(report.top_ports) : []
})

const currentConstraintAssignments = computed(() => {
  return resolveCurrentProjectPinConstraints(
    projectStore.pinConstraints,
    projectStore.topFileId,
    expandedSignalBits.value,
  )
})

const streamInputSignalOrder = computed(() => {
  return buildPhysicalSignalSlotOrder(
    targetBoard.value,
    currentConstraintAssignments.value,
    'input',
  )
})

const streamOutputSignalOrder = computed(() => {
  return buildPhysicalSignalSlotOrder(
    targetBoard.value,
    currentConstraintAssignments.value,
    'output',
  )
})

export const signalCatalogStore = {
  signalSourceReport: readonly(signalSourceReport),
  hasSignalSourceReport: readonly(hasSignalSourceReport),
  hasStaleSignalSourceReport: readonly(hasStaleSignalSourceReport),
  signals: readonly(signals),
  workbenchSignals: readonly(workbenchSignals),
  streamInputSignalOrder: readonly(streamInputSignalOrder),
  streamOutputSignalOrder: readonly(streamOutputSignalOrder),
}
