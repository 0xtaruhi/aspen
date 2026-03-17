import type { ExpandedVerilogPortBit } from '@/lib/verilog-port-bits'

import { computed, readonly } from 'vue'

import { getFpgaBoardDescriptor } from '@/lib/fpga-board-catalog'
import {
  buildPhysicalSignalSlotOrder,
  resolveCurrentProjectPinConstraints,
} from '@/lib/project-constraints'
import { buildSynthesisInputSignature } from '@/lib/synthesis-request-signature'
import { expandVerilogPorts } from '@/lib/verilog-port-bits'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'
import { projectStore } from '@/stores/project'

export type SignalCatalogEntry = ExpandedVerilogPortBit & {
  name: string
  assignedPin: string | null
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
      boardFunction,
      bindingLabel: buildBindingLabel({
        bitName: signal.bitName,
        assignedPin,
        boardFunction,
      }),
    }
  })
})

const targetBoard = computed(() => getFpgaBoardDescriptor(projectStore.targetBoardId))

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

const currentSynthesisSignature = computed(() => {
  return buildSynthesisInputSignature(
    designContextStore.primaryModule.value,
    designContextStore.hardwareSources.value.map((source) => ({
      path: source.path,
      content: source.code,
    })),
  )
})

const currentSynthesisReport = computed(() => {
  const report = hardwareStore.synthesisReport.value
  if (!report?.success) {
    return null
  }

  return hardwareStore.synthesisReportSignature.value === currentSynthesisSignature.value
    ? report
    : null
})

const latestSynthesisReport = computed(() => {
  const report = hardwareStore.synthesisReport.value
  return report?.success ? report : null
})

const signalSourceReport = computed(() => {
  return currentSynthesisReport.value ?? latestSynthesisReport.value
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
  currentSynthesisReport: readonly(currentSynthesisReport),
  latestSynthesisReport: readonly(latestSynthesisReport),
  signals: readonly(signals),
  streamInputSignalOrder: readonly(streamInputSignalOrder),
  streamOutputSignalOrder: readonly(streamOutputSignalOrder),
}
