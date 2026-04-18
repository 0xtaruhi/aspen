import type { HardwareWaveformBatchBinaryV1 } from '@/lib/hardware-client'
import { normalizeUniqueSignalNames, trimSignalNames } from '@/lib/signal-names'

import { markRaw, ref, shallowRef } from 'vue'

export type WaveformTrackBuffer = {
  signal: string
  samples: Uint8Array
  writeIndex: number
  length: number
  sequence: number
  updatedAtMs: number
}

const WAVEFORM_TRACK_CAPACITY = 262_144
const LEGACY_WAVEFORM_HEADER_BYTES = 28
const BIDIRECTIONAL_WAVEFORM_HEADER_BYTES = 32

export const waveformTrackedSignals = ref<string[]>([])
export const waveformTracks = shallowRef<Record<string, WaveformTrackBuffer>>({})
export const waveformRevision = ref(0)
export const waveformSampleRateHz = ref(0)
export const waveformLastSequence = ref(0)
const waveformInputSignalOrder = ref<string[]>([])
const waveformOutputSignalOrder = ref<string[]>([])

type WaveformTrackedSlot = {
  signal: string
  source: 'input' | 'output'
  wordIndex: number
  bitMask: number
}

function createTrack(signal: string): WaveformTrackBuffer {
  return markRaw({
    signal,
    samples: new Uint8Array(WAVEFORM_TRACK_CAPACITY),
    writeIndex: 0,
    length: 0,
    sequence: 0,
    updatedAtMs: 0,
  })
}

function appendSignalSample(
  track: WaveformTrackBuffer,
  value: number,
  sequence: number,
  updatedAtMs: number,
) {
  track.samples[track.writeIndex] = value
  track.writeIndex = (track.writeIndex + 1) % track.samples.length
  track.length = Math.min(track.length + 1, track.samples.length)
  track.sequence = sequence
  track.updatedAtMs = updatedAtMs
}

function buildTrackedSlots(wordsPerCycle: number) {
  const inputSlotBySignal = trackedSignalSlotMapFromOrder(
    waveformInputSignalOrder.value,
    wordsPerCycle,
  )
  const outputSlotBySignal = trackedSignalSlotMapFromOrder(
    waveformOutputSignalOrder.value,
    wordsPerCycle,
  )

  return waveformTrackedSignals.value
    .map((signal) => {
      const inputSlotIndex = inputSlotBySignal.get(signal)
      if (inputSlotIndex !== undefined) {
        return {
          signal,
          source: 'input' as const,
          wordIndex: Math.floor(inputSlotIndex / 16),
          bitMask: 1 << (inputSlotIndex % 16),
        } satisfies WaveformTrackedSlot
      }

      const outputSlotIndex = outputSlotBySignal.get(signal)
      if (outputSlotIndex !== undefined) {
        return {
          signal,
          source: 'output' as const,
          wordIndex: Math.floor(outputSlotIndex / 16),
          bitMask: 1 << (outputSlotIndex % 16),
        } satisfies WaveformTrackedSlot
      }

      return null
    })
    .filter((entry): entry is WaveformTrackedSlot => entry !== null)
}

function trackedSignalSlotMapFromOrder(signalOrder: readonly string[], wordsPerCycle: number) {
  const maxSignalCount = wordsPerCycle * 16
  const slotBySignal = new Map<string, number>()

  for (let index = 0; index < signalOrder.length && index < maxSignalCount; index += 1) {
    const signal = signalOrder[index]
    if (!signal || slotBySignal.has(signal)) {
      continue
    }

    slotBySignal.set(signal, index)
  }

  return slotBySignal
}

export function setWaveformSignalOrder(signalOrder: readonly string[]) {
  waveformInputSignalOrder.value = []
  waveformOutputSignalOrder.value = trimSignalNames(signalOrder)
}

export function setWaveformSignalOrders(
  inputSignalOrder: readonly string[],
  outputSignalOrder: readonly string[],
) {
  waveformInputSignalOrder.value = trimSignalNames(inputSignalOrder)
  waveformOutputSignalOrder.value = trimSignalNames(outputSignalOrder)
}

export function setWaveformTrackedSignals(signals: readonly string[]) {
  const normalized = normalizeUniqueSignalNames(signals)
  waveformTrackedSignals.value = normalized

  const nextTracks: Record<string, WaveformTrackBuffer> = {}
  for (const signal of normalized) {
    nextTracks[signal] = waveformTracks.value[signal] ?? createTrack(signal)
  }
  waveformTracks.value = nextTracks
  waveformRevision.value += 1
}

export function resetWaveformState() {
  waveformTrackedSignals.value = []
  waveformTracks.value = {}
  waveformRevision.value += 1
  waveformSampleRateHz.value = 0
  waveformLastSequence.value = 0
  waveformInputSignalOrder.value = []
  waveformOutputSignalOrder.value = []
}

export function clearWaveformSamples() {
  for (const track of Object.values(waveformTracks.value)) {
    track.samples.fill(0)
    track.writeIndex = 0
    track.length = 0
    track.sequence = 0
    track.updatedAtMs = 0
  }
  waveformRevision.value += 1
  waveformSampleRateHz.value = 0
  waveformLastSequence.value = 0
}

export function onWaveformBatchBinary(batch: HardwareWaveformBatchBinaryV1) {
  if (waveformTrackedSignals.value.length === 0) {
    return
  }

  const bytes = new Uint8Array(batch.payload)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.byteLength < LEGACY_WAVEFORM_HEADER_BYTES) {
    return
  }

  let offset = 0
  const sequence = Number(view.getBigUint64(offset, true))
  offset += 8
  const generatedAtMs = Number(view.getBigUint64(offset, true))
  offset += 8
  const actualHz = view.getFloat64(offset, true)
  offset += 8
  const wordsPerCycle = view.getUint16(offset, true)
  offset += 2
  const batchCycles = view.getUint16(offset, true)
  offset += 2

  if (wordsPerCycle <= 0 || batchCycles <= 0) {
    return
  }

  let inputBufferOffset: number | null = null
  let outputBufferOffset = LEGACY_WAVEFORM_HEADER_BYTES
  const expectedWordsPerBuffer = wordsPerCycle * batchCycles

  if (view.byteLength >= BIDIRECTIONAL_WAVEFORM_HEADER_BYTES) {
    const bufferCount = view.getUint16(offset, true)
    offset += 2
    offset += 2

    const expectedBytes =
      BIDIRECTIONAL_WAVEFORM_HEADER_BYTES + expectedWordsPerBuffer * bufferCount * 2
    if (bufferCount >= 2 && view.byteLength >= expectedBytes) {
      inputBufferOffset = BIDIRECTIONAL_WAVEFORM_HEADER_BYTES
      outputBufferOffset = inputBufferOffset + expectedWordsPerBuffer * 2
    }
  }

  const expectedLegacyBytes = LEGACY_WAVEFORM_HEADER_BYTES + expectedWordsPerBuffer * 2
  if (inputBufferOffset === null && view.byteLength < expectedLegacyBytes) {
    return
  }

  const trackedSlots = buildTrackedSlots(wordsPerCycle)

  if (trackedSlots.length === 0) {
    return
  }

  for (let cycle = 0; cycle < batchCycles; cycle += 1) {
    const inputCycleBaseOffset =
      inputBufferOffset === null ? null : inputBufferOffset + cycle * wordsPerCycle * 2
    const outputCycleBaseOffset = outputBufferOffset + cycle * wordsPerCycle * 2

    for (const trackedSlot of trackedSlots) {
      const cycleBaseOffset =
        trackedSlot.source === 'input' ? inputCycleBaseOffset : outputCycleBaseOffset
      if (cycleBaseOffset === null) {
        continue
      }

      const wordOffset = cycleBaseOffset + trackedSlot.wordIndex * 2
      const word = view.getUint16(wordOffset, true)
      appendSignalSample(
        waveformTracks.value[trackedSlot.signal],
        (word & trackedSlot.bitMask) !== 0 ? 1 : 0,
        sequence,
        generatedAtMs,
      )
    }
  }

  waveformSampleRateHz.value = actualHz > 0 ? actualHz : waveformSampleRateHz.value
  waveformLastSequence.value = sequence
  waveformRevision.value += 1
}
