import { describe, expect, it } from 'vitest'

import type { WaveformTrackBuffer } from '@/stores/hardware-runtime-waveform'

import {
  getAlignedWaveformTrackSample,
  getWaveformPixelStep,
  orderWaveformSignals,
} from './waveform-helpers'

function createTrack(samples: number[], bufferSize = 16): WaveformTrackBuffer {
  const buffer = new Uint8Array(bufferSize)
  const tailSamples = samples.slice(-bufferSize)
  const writeIndex = samples.length % buffer.length

  tailSamples.forEach((sample, index) => {
    buffer[(writeIndex - tailSamples.length + index + buffer.length) % buffer.length] = sample ?? 0
  })

  return {
    signal: 'test',
    samples: buffer,
    writeIndex,
    length: Math.min(samples.length, buffer.length),
    sequence: 1,
    updatedAtMs: 0,
  }
}

describe('waveform helpers', () => {
  it('returns stored samples for non-clock signals', () => {
    const track = createTrack([1, 0, 1, 0, 1, 1, 0], 4)

    expect(getAlignedWaveformTrackSample(track, 0, 4)).toBe(0)
    expect(getAlignedWaveformTrackSample(track, 1, 4)).toBe(1)
    expect(getAlignedWaveformTrackSample(track, 2, 4)).toBe(1)
    expect(getAlignedWaveformTrackSample(track, 3, 4)).toBe(0)
  })

  it('returns stored samples unchanged for clock-like signals', () => {
    const track = createTrack([1, 0, 1, 0, 1, 0], 4)

    expect(getAlignedWaveformTrackSample(track, 0, 4)).toBe(1)
    expect(getAlignedWaveformTrackSample(track, 1, 4)).toBe(0)
    expect(getAlignedWaveformTrackSample(track, 2, 4)).toBe(1)
    expect(getAlignedWaveformTrackSample(track, 3, 4)).toBe(0)
  })

  it('increases pixel step on denser waveforms', () => {
    expect(getWaveformPixelStep(1, 1)).toBe(1)
    expect(getWaveformPixelStep(6, 2)).toBe(3)
    expect(getWaveformPixelStep(40, 2)).toBe(8)
  })

  it('puts clock-like signals first by default', () => {
    expect(orderWaveformSignals(['led', 'clk', 'rst'], [])).toEqual(['clk', 'led', 'rst'])
  })

  it('keeps user-defined order ahead of default clock promotion', () => {
    expect(orderWaveformSignals(['led', 'clk', 'rst'], ['led', 'clk', 'rst'])).toEqual([
      'led',
      'clk',
      'rst',
    ])
  })

  it('only prioritizes new unseen clocks within the default tail', () => {
    expect(orderWaveformSignals(['led', 'clk', 'rst'], ['led'])).toEqual(['led', 'clk', 'rst'])
  })
})
