import { describe, expect, it } from 'vitest'

import { appendSynthesisLogChunk, resolveSynthesisLog } from '../lib/synthesis-log'

describe('synthesis log streaming helpers', () => {
  it('appends only chunks that belong to the active synthesis operation', () => {
    const currentLog = 'start\n'

    const appended = appendSynthesisLogChunk(currentLog, 'op-1', {
      version: 1,
      op_id: 'op-1',
      chunk: 'middle\n',
      generated_at_ms: 1,
    })

    const ignored = appendSynthesisLogChunk(appended, 'op-1', {
      version: 1,
      op_id: 'op-2',
      chunk: 'wrong\n',
      generated_at_ms: 2,
    })

    expect(ignored).toBe('start\nmiddle\n')
  })

  it('prefers live log output over final report and fallback message', () => {
    expect(resolveSynthesisLog('final\n', 'live\n', 'message')).toBe('live')
    expect(resolveSynthesisLog('final\n', '', 'message')).toBe('final')
    expect(resolveSynthesisLog('', '', 'message')).toBe('message')
  })
})
