import type { SynthesisLogChunkV1 } from '@/lib/hardware-client'

import { listenHardwareSynthesisLog } from '@/lib/hardware-client'
import { appendSynthesisLogChunk } from '@/lib/synthesis-log'

import { hardwareRuntimeStore } from './hardware-runtime'
import { synthesisLog, synthesisOperationId } from './hardware-flow-synthesis-state'

let unlistenSynthesisLog: (() => void) | null = null
let synthesisLogListenerPromise: Promise<void> | null = null

function onSynthesisLogChunk(chunk: SynthesisLogChunkV1) {
  // Passing an empty current log extracts only the new chunk for this operation.
  const extractedChunk = appendSynthesisLogChunk('', synthesisOperationId.value, chunk)
  if (!extractedChunk) {
    return
  }

  synthesisLog.append(extractedChunk)
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
        synthesisLogListenerPromise = null
        throw err
      }
      synthesisLogListenerPromise = null
    })

  await synthesisLogListenerPromise
}
