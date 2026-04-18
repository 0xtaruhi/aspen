import type { HardwareWaveformBatchBinaryV1 } from '@/lib/hardware-client'

import { beforeEach, describe, expect, it, vi } from 'vitest'

function createWaveformBatch(options: {
  sequence: bigint
  generatedAtMs: bigint
  actualHz: number
  wordsPerCycle: number
  flags?: number
  inputCycles?: number[][]
  outputCycles: number[][]
}): HardwareWaveformBatchBinaryV1 {
  const batchCycles = options.outputCycles.length
  const hasInputBuffer = Array.isArray(options.inputCycles)
  const headerBytes = hasInputBuffer ? 32 : 28
  const bufferCount = hasInputBuffer ? 2 : 1
  const bytes = new Uint8Array(headerBytes + batchCycles * options.wordsPerCycle * bufferCount * 2)
  const view = new DataView(bytes.buffer)
  let offset = 0

  view.setBigUint64(offset, options.sequence, true)
  offset += 8
  view.setBigUint64(offset, options.generatedAtMs, true)
  offset += 8
  view.setFloat64(offset, options.actualHz, true)
  offset += 8
  view.setUint16(offset, options.wordsPerCycle, true)
  offset += 2
  view.setUint16(offset, batchCycles, true)
  offset += 2

  if (hasInputBuffer) {
    view.setUint16(offset, bufferCount, true)
    offset += 2
    view.setUint16(offset, options.flags ?? 0, true)
    offset += 2
  }

  for (const cycle of options.inputCycles ?? []) {
    for (let wordIndex = 0; wordIndex < options.wordsPerCycle; wordIndex += 1) {
      view.setUint16(offset, cycle[wordIndex] ?? 0, true)
      offset += 2
    }
  }

  for (const cycle of options.outputCycles) {
    for (let wordIndex = 0; wordIndex < options.wordsPerCycle; wordIndex += 1) {
      view.setUint16(offset, cycle[wordIndex] ?? 0, true)
      offset += 2
    }
  }

  return {
    version: 1,
    payload: Array.from(bytes),
  }
}

function readTrackSamples(track: { samples: Uint8Array; writeIndex: number; length: number }) {
  const values: number[] = []
  const oldestIndex =
    (track.writeIndex - track.length + track.samples.length) % track.samples.length

  for (let logicalIndex = 0; logicalIndex < track.length; logicalIndex += 1) {
    const sampleIndex = (oldestIndex + logicalIndex) % track.samples.length
    values.push(track.samples[sampleIndex] ?? 0)
  }

  return values
}

async function loadWaveformStore() {
  return import('./hardware-runtime-waveform')
}

describe('hardware runtime waveform', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('tracks selected signals in append-only ring buffers', async () => {
    const waveformStore = await loadWaveformStore()

    waveformStore.setWaveformSignalOrder(['sig_a', 'sig_b'])
    waveformStore.setWaveformTrackedSignals(['sig_a'])
    waveformStore.onWaveformBatchBinary(
      createWaveformBatch({
        sequence: 7n,
        generatedAtMs: 120n,
        actualHz: 2_000,
        wordsPerCycle: 1,
        outputCycles: [[0b1], [0b0], [0b1]],
      }),
    )

    const track = waveformStore.waveformTracks.value.sig_a

    expect(readTrackSamples(track)).toEqual([1, 0, 1])
    expect(waveformStore.waveformSampleRateHz.value).toBe(2_000)
    expect(waveformStore.waveformLastSequence.value).toBe(7)
  })

  it('advances the last sequence even when no tracked signals are active', async () => {
    const waveformStore = await loadWaveformStore()

    waveformStore.onWaveformBatchBinary(
      createWaveformBatch({
        sequence: 8n,
        generatedAtMs: 180n,
        actualHz: 2_000,
        wordsPerCycle: 1,
        outputCycles: [[0b1]],
      }),
    )

    expect(waveformStore.waveformLastSequence.value).toBe(8)
  })

  it('maps tracked signals to the correct bit slot across multiple words', async () => {
    const outputSignalOrder = Array.from({ length: 17 }, (_, index) =>
      index === 16 ? 'sig_q' : `unused_${index}`,
    )
    const waveformStore = await loadWaveformStore()

    waveformStore.setWaveformSignalOrder(outputSignalOrder)
    waveformStore.setWaveformTrackedSignals(['sig_q'])
    waveformStore.onWaveformBatchBinary(
      createWaveformBatch({
        sequence: 9n,
        generatedAtMs: 240n,
        actualHz: 1_000,
        wordsPerCycle: 2,
        outputCycles: [
          [0x0000, 0x0001],
          [0x0000, 0x0000],
        ],
      }),
    )

    const track = waveformStore.waveformTracks.value.sig_q

    expect(readTrackSamples(track)).toEqual([1, 0])
  })

  it('advances the last sequence when tracked signals do not map to the current slot order', async () => {
    const waveformStore = await loadWaveformStore()

    waveformStore.setWaveformSignalOrder(['sig_a'])
    waveformStore.setWaveformTrackedSignals(['sig_b'])
    waveformStore.onWaveformBatchBinary(
      createWaveformBatch({
        sequence: 10n,
        generatedAtMs: 260n,
        actualHz: 1_000,
        wordsPerCycle: 1,
        outputCycles: [[0b1]],
      }),
    )

    expect(waveformStore.waveformLastSequence.value).toBe(10)
    expect(readTrackSamples(waveformStore.waveformTracks.value.sig_b)).toEqual([])
  })

  it('reads input signals from the write buffer in bidirectional waveform batches', async () => {
    const waveformStore = await loadWaveformStore()

    waveformStore.setWaveformSignalOrders(['clk'], ['sig_out'])
    waveformStore.setWaveformTrackedSignals(['clk', 'sig_out'])
    waveformStore.onWaveformBatchBinary(
      createWaveformBatch({
        sequence: 11n,
        generatedAtMs: 360n,
        actualHz: 4_000,
        wordsPerCycle: 1,
        inputCycles: [[0b1], [0b0], [0b1]],
        outputCycles: [[0b0], [0b1], [0b1]],
      }),
    )

    expect(readTrackSamples(waveformStore.waveformTracks.value.clk)).toEqual([1, 0, 1])
    expect(readTrackSamples(waveformStore.waveformTracks.value.sig_out)).toEqual([0, 1, 1])
    expect(waveformStore.waveformSampleRateHz.value).toBe(4_000)
    expect(waveformStore.waveformLastSequence.value).toBe(11)
  })

  it('replaces buffered samples when a batch is marked as truncated exact tail data', async () => {
    const waveformStore = await loadWaveformStore()

    waveformStore.setWaveformSignalOrders(['clk'], ['sig_out'])
    waveformStore.setWaveformTrackedSignals(['clk', 'sig_out'])
    waveformStore.onWaveformBatchBinary(
      createWaveformBatch({
        sequence: 12n,
        generatedAtMs: 400n,
        actualHz: 2_000,
        wordsPerCycle: 1,
        inputCycles: [[0b1], [0b0]],
        outputCycles: [[0b0], [0b1]],
      }),
    )
    waveformStore.onWaveformBatchBinary(
      createWaveformBatch({
        sequence: 13n,
        generatedAtMs: 416n,
        actualHz: 2_000,
        wordsPerCycle: 1,
        flags: 0x0001,
        inputCycles: [[0b0], [0b1], [0b0]],
        outputCycles: [[0b1], [0b1], [0b0]],
      }),
    )

    expect(readTrackSamples(waveformStore.waveformTracks.value.clk)).toEqual([0, 1, 0])
    expect(readTrackSamples(waveformStore.waveformTracks.value.sig_out)).toEqual([1, 1, 0])
    expect(waveformStore.waveformLastSequence.value).toBe(13)
  })

  it('clears buffered waveform samples and metadata without dropping tracked signals', async () => {
    const waveformStore = await loadWaveformStore()

    waveformStore.setWaveformSignalOrder(['sig_a'])
    waveformStore.setWaveformTrackedSignals(['sig_a'])
    waveformStore.onWaveformBatchBinary(
      createWaveformBatch({
        sequence: 3n,
        generatedAtMs: 64n,
        actualHz: 500,
        wordsPerCycle: 1,
        outputCycles: [[0b1]],
      }),
    )

    waveformStore.clearWaveformSamples()

    expect(readTrackSamples(waveformStore.waveformTracks.value.sig_a)).toEqual([])
    expect(waveformStore.waveformTrackedSignals.value).toEqual(['sig_a'])
    expect(waveformStore.waveformSampleRateHz.value).toBe(0)
    expect(waveformStore.waveformLastSequence.value).toBe(0)
  })
})
