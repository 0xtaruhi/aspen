import type {
  ImplementationLogChunkV1,
  ImplementationReportV1,
  ImplementationRequestV1,
  SynthesisReportV1,
  SynthesisLogChunkV1,
  SynthesisRequestV1,
} from '@/lib/hardware-client'

import { readonly, ref, watch } from 'vue'

import {
  cancelHardwareImplementation,
  cancelHardwareSynthesis,
  runHardwareImplementation,
  runHardwareSynthesis,
} from '@/lib/hardware-client'
import { saveProjectToCurrentPath } from '@/lib/project-io'
import { translate } from '@/lib/i18n'
import { buildImplementationInputSignature } from '@/lib/implementation-request-signature'
import { buildSynthesisInputSignature } from '@/lib/synthesis-request-signature'
import { appendSynthesisLogChunk } from '@/lib/synthesis-log'
import { listenHardwareImplementationLog, listenHardwareSynthesisLog } from '@/lib/hardware-client'
import { hardwareRuntimeStore } from './hardware-runtime'
import {
  projectStore,
  type ProjectImplementationCacheSnapshot,
  type ProjectSynthesisCacheSnapshot,
} from './project'

const synthesisRunning = ref(false)
const synthesisReport = ref<SynthesisReportV1 | null>(null)
const synthesisReportSignature = ref<string | null>(null)
const synthesisLiveLog = ref('')
const synthesisMessage = ref('')
const synthesisOperationId = ref<string | null>(null)
const synthesisCancelling = ref(false)
const synthesisCancelled = ref(false)
const implementationRunning = ref(false)
const implementationReport = ref<ImplementationReportV1 | null>(null)
const implementationReportSignature = ref<string | null>(null)
const implementationLiveLog = ref('')
const implementationMessage = ref('')
const implementationOperationId = ref<string | null>(null)
const implementationCancelling = ref(false)
const implementationCancelled = ref(false)
let synthesisLogBuffer = ''
let synthesisLogFlushTimer: ReturnType<typeof setTimeout> | null = null
let implementationLogBuffer = ''
let implementationLogFlushTimer: ReturnType<typeof setTimeout> | null = null
let unlistenSynthesisLog: (() => void) | null = null
let synthesisLogListenerPromise: Promise<void> | null = null
let unlistenImplementationLog: (() => void) | null = null
let implementationLogListenerPromise: Promise<void> | null = null

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isCancelledMessage(message: string) {
  return message.toLowerCase().includes('cancelled')
}

function onSynthesisLogChunk(chunk: SynthesisLogChunkV1) {
  const appended = appendSynthesisLogChunk('', synthesisOperationId.value, chunk)
  if (!appended) {
    return
  }

  synthesisLogBuffer += appended
  scheduleSynthesisLogFlush()
}

function scheduleSynthesisLogFlush() {
  if (synthesisLogFlushTimer) {
    return
  }

  synthesisLogFlushTimer = setTimeout(() => {
    flushSynthesisLogBuffer()
  }, 50)
}

function flushSynthesisLogBuffer() {
  if (synthesisLogFlushTimer) {
    clearTimeout(synthesisLogFlushTimer)
    synthesisLogFlushTimer = null
  }

  if (!synthesisLogBuffer) {
    return
  }

  synthesisLiveLog.value += synthesisLogBuffer
  synthesisLogBuffer = ''
}

function onImplementationLogChunk(chunk: ImplementationLogChunkV1) {
  if (implementationOperationId.value !== chunk.op_id) {
    return
  }

  if (chunk.stage === 'yosys') {
    return
  }

  const stagePrefix = `[${chunk.stage}] `
  implementationLogBuffer += chunk.chunk
    .split(/\r?\n/)
    .filter((line, index, lines) => {
      return line.length > 0 || index < lines.length - 1
    })
    .map((line) => `${stagePrefix}${line}`)
    .join('\n')

  if (!implementationLogBuffer.endsWith('\n')) {
    implementationLogBuffer += '\n'
  }

  scheduleImplementationLogFlush()
}

function scheduleImplementationLogFlush() {
  if (implementationLogFlushTimer) {
    return
  }

  implementationLogFlushTimer = setTimeout(() => {
    flushImplementationLogBuffer()
  }, 50)
}

function flushImplementationLogBuffer() {
  if (implementationLogFlushTimer) {
    clearTimeout(implementationLogFlushTimer)
    implementationLogFlushTimer = null
  }

  if (!implementationLogBuffer) {
    return
  }

  implementationLiveLog.value += implementationLogBuffer
  implementationLogBuffer = ''
}

function applyPersistedSynthesisState(snapshot: ProjectSynthesisCacheSnapshot | null) {
  flushSynthesisLogBuffer()
  synthesisRunning.value = false
  synthesisCancelling.value = false
  synthesisCancelled.value = false
  synthesisOperationId.value = null
  synthesisMessage.value = ''
  synthesisLiveLog.value = ''
  synthesisLogBuffer = ''
  synthesisReport.value = snapshot?.report ?? null
  synthesisReportSignature.value = snapshot?.signature ?? null
}

function applyPersistedImplementationState(snapshot: ProjectImplementationCacheSnapshot | null) {
  flushImplementationLogBuffer()
  implementationRunning.value = false
  implementationCancelling.value = false
  implementationCancelled.value = false
  implementationOperationId.value = null
  implementationMessage.value = ''
  implementationLiveLog.value = ''
  implementationLogBuffer = ''
  implementationReport.value = snapshot?.report ?? null
  implementationReportSignature.value = snapshot?.signature ?? null
}

async function ensureSynthesisLogListener() {
  if (unlistenSynthesisLog) {
    return
  }

  if (synthesisLogListenerPromise) {
    await synthesisLogListenerPromise
    return
  }

  synthesisLogListenerPromise = listenHardwareSynthesisLog(onSynthesisLogChunk)
    .then((unlisten) => {
      unlistenSynthesisLog = unlisten
    })
    .catch((err) => {
      if (!hardwareRuntimeStore.isTauriUnavailable(err)) {
        throw err
      }
    })
    .finally(() => {
      synthesisLogListenerPromise = null
    })

  await synthesisLogListenerPromise
}

async function ensureImplementationLogListener() {
  if (unlistenImplementationLog) {
    return
  }

  if (implementationLogListenerPromise) {
    await implementationLogListenerPromise
    return
  }

  implementationLogListenerPromise = listenHardwareImplementationLog(onImplementationLogChunk)
    .then((unlisten) => {
      unlistenImplementationLog = unlisten
    })
    .catch((err) => {
      if (!hardwareRuntimeStore.isTauriUnavailable(err)) {
        throw err
      }
    })
    .finally(() => {
      implementationLogListenerPromise = null
    })

  await implementationLogListenerPromise
}

async function runSynthesis(request: SynthesisRequestV1): Promise<SynthesisReportV1> {
  await ensureSynthesisLogListener()
  synthesisRunning.value = true
  synthesisCancelling.value = false
  synthesisCancelled.value = false
  synthesisMessage.value = ''
  synthesisLiveLog.value = ''
  synthesisLogBuffer = ''
  flushSynthesisLogBuffer()
  synthesisOperationId.value = request.op_id
  const requestSignature = buildSynthesisInputSignature(request.top_module, request.files)

  try {
    const report = await runHardwareSynthesis(request)
    applyPersistedSynthesisState({
      version: 1,
      signature: requestSignature,
      report,
    })
    projectStore.setSynthesisCache({
      version: 1,
      signature: requestSignature,
      report,
    })

    try {
      await saveProjectToCurrentPath({ silent: true })
    } catch (err) {
      synthesisMessage.value = translate('autoSaveProjectFailed', {
        message: getErrorMessage(err),
      })
    }

    return report
  } catch (err) {
    synthesisMessage.value = getErrorMessage(err)
    synthesisCancelled.value = isCancelledMessage(synthesisMessage.value)
    throw err
  } finally {
    flushSynthesisLogBuffer()
    synthesisRunning.value = false
    synthesisCancelling.value = false
    synthesisOperationId.value = null
  }
}

async function runImplementation(
  request: ImplementationRequestV1,
): Promise<ImplementationReportV1> {
  await ensureImplementationLogListener()
  implementationRunning.value = true
  implementationCancelling.value = false
  implementationCancelled.value = false
  implementationReport.value = null
  implementationMessage.value = ''
  implementationLiveLog.value = ''
  implementationLogBuffer = ''
  flushImplementationLogBuffer()
  implementationOperationId.value = request.op_id
  implementationReportSignature.value = buildImplementationInputSignature(
    request.top_module,
    request.target_device_id,
    request.constraint_xml,
    request.place_mode,
    request.files,
  )

  try {
    const report = await runHardwareImplementation(request)
    const snapshot = {
      version: 1 as const,
      signature: implementationReportSignature.value ?? '',
      report,
    }
    applyPersistedImplementationState(snapshot)
    projectStore.setImplementationCache(snapshot)

    try {
      await saveProjectToCurrentPath({ silent: true })
    } catch (err) {
      implementationMessage.value = translate('autoSaveImplementationProjectFailed', {
        message: getErrorMessage(err),
      })
    }

    return report
  } catch (err) {
    flushImplementationLogBuffer()
    implementationMessage.value = getErrorMessage(err)
    implementationCancelled.value = isCancelledMessage(implementationMessage.value)
    throw err
  } finally {
    flushImplementationLogBuffer()
    implementationRunning.value = false
    implementationCancelling.value = false
    implementationOperationId.value = null
  }
}

async function cancelSynthesis() {
  const opId = synthesisOperationId.value
  if (!opId || !synthesisRunning.value || synthesisCancelling.value) {
    return false
  }

  synthesisCancelling.value = true
  synthesisLogBuffer += `${translate('cancel')}...\n`
  scheduleSynthesisLogFlush()

  try {
    return await cancelHardwareSynthesis(opId)
  } catch (err) {
    synthesisCancelling.value = false
    synthesisMessage.value = getErrorMessage(err)
    throw err
  }
}

async function cancelImplementation() {
  const opId = implementationOperationId.value
  if (!opId || !implementationRunning.value || implementationCancelling.value) {
    return false
  }

  implementationCancelling.value = true
  implementationLogBuffer += `[control] ${translate('cancel')}...\n`
  scheduleImplementationLogFlush()

  try {
    return await cancelHardwareImplementation(opId)
  } catch (err) {
    implementationCancelling.value = false
    implementationMessage.value = getErrorMessage(err)
    throw err
  }
}

watch(
  () => projectStore.synthesisCache,
  (snapshot) => {
    applyPersistedSynthesisState(snapshot)
  },
  { immediate: true },
)

watch(
  () => projectStore.implementationCache,
  (snapshot) => {
    applyPersistedImplementationState(snapshot)
  },
  { immediate: true },
)

export const hardwareFlowStore = {
  synthesisRunning: readonly(synthesisRunning),
  synthesisCancelling: readonly(synthesisCancelling),
  synthesisCancelled: readonly(synthesisCancelled),
  synthesisReport: readonly(synthesisReport),
  synthesisReportSignature: readonly(synthesisReportSignature),
  synthesisLiveLog: readonly(synthesisLiveLog),
  synthesisMessage: readonly(synthesisMessage),
  implementationRunning: readonly(implementationRunning),
  implementationCancelling: readonly(implementationCancelling),
  implementationCancelled: readonly(implementationCancelled),
  implementationReport: readonly(implementationReport),
  implementationReportSignature: readonly(implementationReportSignature),
  implementationLiveLog: readonly(implementationLiveLog),
  implementationMessage: readonly(implementationMessage),
  runSynthesis,
  cancelSynthesis,
  runImplementation,
  cancelImplementation,
}
