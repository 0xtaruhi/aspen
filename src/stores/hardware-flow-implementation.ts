import type { ImplementationReportV1, ImplementationRequestV1 } from '@/lib/hardware-client'

import { watch } from 'vue'

import { runHardwareImplementation } from '@/lib/hardware-client'
import { translate } from '@/lib/i18n'
import { buildImplementationInputSignature } from '@/lib/implementation-request-signature'
import { saveProjectToCurrentPath } from '@/lib/project-io'

import { getErrorMessage } from './hardware-flow-log'
import { ensureImplementationLogListener } from './hardware-flow-implementation-listener'
import {
  applyPersistedImplementationState,
  beginImplementationRun,
  finishImplementationRun,
  flushImplementationLog,
  implementationFlowState,
  implementationOperationId,
  setImplementationMessage,
} from './hardware-flow-implementation-state'
import { projectStore } from './project'

async function runImplementation(
  request: ImplementationRequestV1,
): Promise<ImplementationReportV1> {
  await ensureImplementationLogListener()
  const requestSignature = buildImplementationInputSignature(
    request.top_module,
    request.target_device_id,
    request.constraint_xml,
    request.place_mode,
    request.files,
  )
  beginImplementationRun(request.op_id, requestSignature)

  try {
    const report = await runHardwareImplementation(request)
    finishImplementationRun()
    const snapshot = {
      version: 1 as const,
      signature: requestSignature,
      report,
    }
    applyPersistedImplementationState(snapshot)
    projectStore.setImplementationCache(snapshot)

    try {
      await saveProjectToCurrentPath()
    } catch (err) {
      setImplementationMessage(
        translate('autoSaveImplementationProjectFailed', {
          message: getErrorMessage(err),
        }),
      )
    }

    return report
  } catch (err) {
    flushImplementationLog()
    setImplementationMessage(getErrorMessage(err))
    throw err
  } finally {
    if (implementationOperationId.value) {
      finishImplementationRun()
    }
  }
}

watch(
  () => projectStore.implementationCache,
  (snapshot) => {
    applyPersistedImplementationState(snapshot)
  },
  { immediate: true },
)

export const implementationFlowStore = {
  ...implementationFlowState,
  runImplementation,
}
