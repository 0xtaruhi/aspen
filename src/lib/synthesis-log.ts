import type { SynthesisLogChunkV1 } from './hardware-client'

export function appendSynthesisLogChunk(
  currentLog: string,
  activeOperationId: string | null,
  chunk: SynthesisLogChunkV1,
): string {
  if (!activeOperationId || chunk.op_id !== activeOperationId) {
    return currentLog
  }

  return `${currentLog}${chunk.chunk}`
}

export function resolveSynthesisLog(
  reportLog: string | null,
  liveLog: string,
  message: string,
): string {
  if (liveLog.trim().length > 0) {
    return liveLog.trimEnd()
  }

  if (reportLog && reportLog.trim().length > 0) {
    return reportLog.trim()
  }

  if (message.trim().length > 0) {
    return message
  }

  return 'Run synthesis to invoke Yosys on the current project sources.'
}
