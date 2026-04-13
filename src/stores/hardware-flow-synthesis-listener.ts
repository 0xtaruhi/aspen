import type { SynthesisLogChunkV1 } from '@/lib/hardware-client'

import { listenHardwareSynthesisLog } from '@/lib/hardware-client'
import { appendSynthesisLogChunk } from '@/lib/synthesis-log'

import { hardwareRuntimeStore } from './hardware-runtime'
import { synthesisLog, synthesisOperationId } from './hardware-flow-synthesis-state'

let unlistenSynthesisLog: (() => void) | null = null
let synthesisLogListenerPromise: Promise<void> | null = null

function onSynthesisLogChunk(chunk: SynthesisLogChunkV1) {
  const appended = appendSynthesisLogChunk('', synthesisOperationId.value, chunk)
  if (!appended) {
    return
  }

  synthesisLog.append(appended)
}

export async function ensureSynthesisLogListener() {
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
