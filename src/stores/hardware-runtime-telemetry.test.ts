import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { HardwareDataBatchBinaryV1 } from '@/lib/hardware-client'

import { dataStreamStatus, signalTelemetry } from './hardware-runtime-state'
import {
  onDataBatchBinary,
  onDataCatalog,
  resetRuntimeViewState,
} from './hardware-runtime-telemetry'

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

function createLegacyBinaryBatchPayload(options: {
  sequence: bigint
  generatedAtMs: bigint
  droppedSamples: bigint
  queueFill: number
  queueCapacity: number
  batchCycles: number
  updates: Array<{
    signalId: number
    latest: boolean
    highRatio: number
    edgeCount: number
  }>
}): number[] {
  const bytes = new Uint8Array(32 + options.updates.length * 9)
  const view = new DataView(bytes.buffer)
  let offset = 0

  view.setBigUint64(offset, options.sequence, true)
  offset += 8
  view.setBigUint64(offset, options.generatedAtMs, true)
  offset += 8
  view.setBigUint64(offset, options.droppedSamples, true)
  offset += 8
  view.setUint16(offset, options.queueFill, true)
  offset += 2
  view.setUint16(offset, options.queueCapacity, true)
  offset += 2
  view.setUint16(offset, options.batchCycles, true)
  offset += 2
  view.setUint16(offset, options.updates.length, true)
  offset += 2

  for (const update of options.updates) {
    view.setUint16(offset, update.signalId, true)
    offset += 2
    view.setUint8(offset, update.latest ? 1 : 0)
    offset += 1
    view.setFloat32(offset, update.highRatio, true)
    offset += 4
    view.setUint16(offset, update.edgeCount, true)
    offset += 2
  }

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

  it('merges incremental signal catalog updates instead of discarding earlier ids', async () => {
    vi.useFakeTimers()
    dataStreamStatus.value.running = true

    onDataCatalog({
      version: 1,
      generated_at_ms: 1,
      entries: [{ signal_id: 7, signal: 'row[0]' }],
    })
    onDataCatalog({
      version: 1,
      generated_at_ms: 2,
      entries: [{ signal_id: 8, signal: 'row[1]' }],
    })

    onDataBatchBinary({
      version: 1,
      payload: createLegacyBinaryBatchPayload({
        sequence: 3n,
        generatedAtMs: 99n,
        droppedSamples: 0n,
        queueFill: 1,
        queueCapacity: 8,
        batchCycles: 16,
        updates: [
          {
            signalId: 7,
            latest: true,
            highRatio: 1,
            edgeCount: 0,
          },
        ],
      }),
    } as HardwareDataBatchBinaryV1)

    await vi.runAllTimersAsync()

    expect(signalTelemetry.value['row[0]']?.latest).toBe(true)
    expect(dataStreamStatus.value.sequence).toBe(3)
  })
})
