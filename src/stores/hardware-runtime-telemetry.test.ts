import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HardwareDataBatchBinaryV1 } from '@/lib/hardware-client'

import { dataStreamStatus } from './hardware-runtime-state'
import { onDataBatchBinary, resetRuntimeViewState } from './hardware-runtime-telemetry'

function createTruncatedV2Payload(): number[] {
  const bytes = new Uint8Array(40)
  const view = new DataView(bytes.buffer)
  let offset = 0

  view.setBigUint64(offset, 9n, true)
  offset += 8
  view.setBigUint64(offset, 123n, true)
  offset += 8
  view.setBigUint64(offset, 5n, true)
  offset += 8
  view.setUint16(offset, 3, true)
  offset += 2
  view.setUint16(offset, 8, true)
  offset += 2
  view.setUint16(offset, 16, true)
  offset += 2
  view.setUint16(offset, 0, true)

  return Array.from(bytes)
}

describe('hardware runtime telemetry', () => {
  beforeEach(() => {
    vi.useRealTimers()
    resetRuntimeViewState()
  })

  it('rejects truncated v2 batches instead of decoding them as legacy data', async () => {
    vi.useFakeTimers()
    dataStreamStatus.value.running = true
    const batch = {
      version: 2,
      payload: createTruncatedV2Payload(),
    } as unknown as HardwareDataBatchBinaryV1

    onDataBatchBinary(batch)

    await vi.runAllTimersAsync()

    expect(dataStreamStatus.value.sequence).toBe(0)
    expect(dataStreamStatus.value.dropped_samples).toBe(0)
    expect(dataStreamStatus.value.queue_fill).toBe(0)
    expect(dataStreamStatus.value.last_batch_cycles).toBe(0)
  })
})
