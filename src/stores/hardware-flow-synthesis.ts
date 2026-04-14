import type { SynthesisReportV1, SynthesisRequestV1 } from '@/lib/hardware-client'

import { watch } from 'vue'

import { runHardwareSynthesis } from '@/lib/hardware-client'
import { translate } from '@/lib/i18n'
import { saveProjectToCurrentPath } from '@/lib/project-io'
import { buildSynthesisInputSignature } from '@/lib/synthesis-request-signature'

import { getErrorMessage } from './hardware-flow-log'
import { ensureSynthesisLogListener } from './hardware-flow-synthesis-listener'
import {
  applyPersistedSynthesisState,
  beginSynthesisRun,
  finishSynthesisRun,
  setSynthesisMessage,
  synthesisOperationId,
  synthesisFlowState,
} from './hardware-flow-synthesis-state'
import { projectStore } from './project'

async function runSynthesis(request: SynthesisRequestV1): Promise<SynthesisReportV1> {
  await ensureSynthesisLogListener()
  beginSynthesisRun(request.op_id)
  const requestSignature = buildSynthesisInputSignature(request.top_module, request.files)

  try {
    const report = await runHardwareSynthesis(request)
    finishSynthesisRun()
    const snapshot = {
      version: 1 as const,
      signature: requestSignature,
      report,
    }
    applyPersistedSynthesisState(snapshot)
    projectStore.setSynthesisCache(snapshot)

    try {
      await saveProjectToCurrentPath()
    } catch (err) {
      setSynthesisMessage(
        translate('autoSaveProjectFailed', {
          message: getErrorMessage(err),
        }),
      )
    }

    return report
  } catch (err) {
    setSynthesisMessage(getErrorMessage(err))
    throw err
  } finally {
    if (synthesisOperationId.value) {
      finishSynthesisRun()
    }
  }
}

watch(
  () => projectStore.synthesisCache,
  (snapshot) => {
    applyPersistedSynthesisState(snapshot)
  },
  { immediate: true },
)

export const synthesisFlowStore = {
  ...synthesisFlowState,
  runSynthesis,
}
