import { describe, expect, it } from 'vitest'

import type { WaveformTrackBuffer } from '@/stores/hardware-runtime-waveform'

import { getAlignedWaveformTrackSample, orderWaveformSignals } from './waveform-helpers'

function createTrack(samples: number[]): WaveformTrackBuffer {
  const buffer = new Uint8Array(16)
  buffer.set(samples)

  return {
    signal: 'test',
    samples: buffer,
    writeIndex: samples.length % buffer.length,
    length: samples.length,
    sequence: 1,
    updatedAtMs: 0,
  }
}

describe('waveform helpers', () => {
  it('returns stored samples for non-clock signals', () => {
    const track = createTrack([1, 0, 1])

    expect(getAlignedWaveformTrackSample('led', track, 0, 3)).toBe(1)
    expect(getAlignedWaveformTrackSample('led', track, 1, 3)).toBe(0)
    expect(getAlignedWaveformTrackSample('led', track, 2, 3)).toBe(1)
  })

  it('returns stored samples unchanged for clock-like signals', () => {
    const track = createTrack([0, 0, 0, 0])

    expect(getAlignedWaveformTrackSample('clk', track, 0, 4)).toBe(0)
    expect(getAlignedWaveformTrackSample('clk', track, 1, 4)).toBe(0)
    expect(getAlignedWaveformTrackSample('clk', track, 2, 4)).toBe(0)
    expect(getAlignedWaveformTrackSample('clk', track, 3, 4)).toBe(0)
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
