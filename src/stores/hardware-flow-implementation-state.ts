import type { ImplementationReportV1 } from '@/lib/hardware-client'
import type { ProjectImplementationCacheSnapshot } from './project'

import { readonly, ref } from 'vue'

import { createBufferedLogStream } from './hardware-flow-log'

const implementationRunning = ref(false)
const implementationReport = ref<ImplementationReportV1 | null>(null)
const implementationReportSignature = ref<string | null>(null)
const implementationMessage = ref('')
const implementationOperationId = ref<string | null>(null)
const implementationLog = createBufferedLogStream()

export function applyPersistedImplementationState(
  snapshot: ProjectImplementationCacheSnapshot | null,
) {
  implementationLog.clear()
  implementationRunning.value = false
  implementationOperationId.value = null
  implementationMessage.value = ''
  implementationReport.value = snapshot?.report ?? null
  implementationReportSignature.value = snapshot?.signature ?? null
}

export function beginImplementationRun(opId: string, signature: string) {
  implementationRunning.value = true
  implementationReport.value = null
  implementationMessage.value = ''
  implementationLog.clear()
  implementationOperationId.value = opId
  implementationReportSignature.value = signature
}

export function setImplementationMessage(message: string) {
  implementationMessage.value = message
}

export function flushImplementationLog() {
  implementationLog.flush()
}

export function finishImplementationRun() {
  implementationLog.flush()
  implementationRunning.value = false
  implementationOperationId.value = null
}

export { implementationLog, implementationOperationId }

export const implementationFlowState = {
  implementationRunning: readonly(implementationRunning),
  implementationReport: readonly(implementationReport),
  implementationReportSignature: readonly(implementationReportSignature),
  implementationLiveLog: readonly(implementationLog.liveLog),
  implementationMessage: readonly(implementationMessage),
}
