import { isLikelyClockPort } from '@/lib/project-constraints'
import type { WaveformTrackBuffer } from '@/stores/hardware-runtime-waveform'

export function getWaveformTrackSample(track: WaveformTrackBuffer, logicalIndex: number) {
  if (logicalIndex < 0 || logicalIndex >= track.length) {
    return 0
  }

  const oldestIndex =
    (track.writeIndex - track.length + track.samples.length) % track.samples.length
  const sampleIndex = (oldestIndex + logicalIndex) % track.samples.length
  return track.samples[sampleIndex] ?? 0
}

export function getAlignedWaveformTrackSample(
  _signal: string,
  track: WaveformTrackBuffer,
  globalSampleIndex: number,
  maxTrackLength: number,
) {
  const localIndex = globalSampleIndex - (maxTrackLength - track.length)
  if (localIndex < 0 || localIndex >= track.length) {
    return 0
  }

  return getWaveformTrackSample(track, localIndex)
}

export function orderWaveformSignals(
  visibleSignals: readonly string[],
  persistedSignalOrder: readonly string[],
) {
  const visibleSignalSet = new Set(visibleSignals)
  const orderedSignals = persistedSignalOrder.filter((signal) => visibleSignalSet.has(signal))
  const seenSignals = new Set(orderedSignals)
  const defaultClockSignals: string[] = []
  const defaultRegularSignals: string[] = []

  for (const signal of visibleSignals) {
    if (seenSignals.has(signal)) {
      continue
    }

    seenSignals.add(signal)

    if (isLikelyClockPort(signal)) {
      defaultClockSignals.push(signal)
      continue
    }

    defaultRegularSignals.push(signal)
  }

  return [...orderedSignals, ...defaultClockSignals, ...defaultRegularSignals]
}
