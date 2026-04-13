import type { ImplementationLogChunkV1 } from '@/lib/hardware-client'

import { listenHardwareImplementationLog } from '@/lib/hardware-client'

import { hardwareRuntimeStore } from './hardware-runtime'
import { implementationLog, implementationOperationId } from './hardware-flow-implementation-state'

let unlistenImplementationLog: (() => void) | null = null
let implementationLogListenerPromise: Promise<void> | null = null

function onImplementationLogChunk(chunk: ImplementationLogChunkV1) {
  if (implementationOperationId.value !== chunk.op_id) {
    return
  }

  if (chunk.stage === 'yosys') {
    return
  }

  const stagePrefix = `[${chunk.stage}] `
  const formattedChunk = chunk.chunk
    .split(/\r?\n/)
    .filter((line, index, lines) => {
      return line.length > 0 || index < lines.length - 1
    })
    .map((line) => `${stagePrefix}${line}`)
    .join('\n')

  implementationLog.append(formattedChunk.endsWith('\n') ? formattedChunk : `${formattedChunk}\n`)
}

export async function ensureImplementationLogListener() {
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
