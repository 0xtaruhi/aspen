import type { SynthesisReportV1 } from '@/lib/hardware-client'
import type { ProjectSynthesisCacheSnapshot } from './project'

import { readonly, ref } from 'vue'

import { createBufferedLogStream } from './hardware-flow-log'

const synthesisRunning = ref(false)
const synthesisReport = ref<SynthesisReportV1 | null>(null)
const synthesisReportSignature = ref<string | null>(null)
const synthesisMessage = ref('')
const synthesisOperationId = ref<string | null>(null)
const synthesisLog = createBufferedLogStream()

export function applyPersistedSynthesisState(snapshot: ProjectSynthesisCacheSnapshot | null) {
  synthesisLog.clear()
  synthesisRunning.value = false
  synthesisOperationId.value = null
  synthesisMessage.value = ''
  synthesisReport.value = snapshot?.report ?? null
  synthesisReportSignature.value = snapshot?.signature ?? null
}

export function beginSynthesisRun(opId: string) {
  synthesisRunning.value = true
  synthesisMessage.value = ''
  synthesisLog.clear()
  synthesisOperationId.value = opId
}

export function setSynthesisMessage(message: string) {
  synthesisMessage.value = message
}

export function finishSynthesisRun() {
  synthesisLog.flush()
  synthesisRunning.value = false
  synthesisOperationId.value = null
}

export { synthesisLog, synthesisOperationId, synthesisReport, synthesisReportSignature }

export const synthesisFlowState = {
  synthesisRunning: readonly(synthesisRunning),
  synthesisReport: readonly(synthesisReport),
  synthesisReportSignature: readonly(synthesisReportSignature),
  synthesisLiveLog: readonly(synthesisLog.liveLog),
  synthesisMessage: readonly(synthesisMessage),
}
