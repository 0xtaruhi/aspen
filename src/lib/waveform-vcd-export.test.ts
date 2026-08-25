import { describe, expect, it } from 'vitest'

import type { WaveformTrackBuffer } from '@/stores/hardware-runtime-waveform'

import { buildWaveformVcdPayload } from './waveform-vcd-export'

function track(samples: number[], writeIndex = samples.length): WaveformTrackBuffer {
  return {
    signal: '',
    samples: Uint8Array.from(samples),
    writeIndex: writeIndex % samples.length,
    length: samples.length,
    sequence: 0,
    updatedAtMs: 0,
  }
}

describe('buildWaveformVcdPayload', () => {
  it('right-aligns ring buffers and packs signal values by bit', () => {
    const payload = buildWaveformVcdPayload(
      {
        signals: ['clk', 'data'],
        tracks: {
          clk: track([1, 0, 1, 0], 2),
          data: { ...track([1, 1]), length: 1, writeIndex: 1 },
        },
        sampleRateHz: 50_000_000,
      },
      '/tmp/wave.vcd.gz',
    )
    const view = new DataView(payload.buffer)
    const pathLength = view.getUint32(20, true)
    let offset = 24 + pathLength
    for (let index = 0; index < 2; index += 1) {
      expect(payload[offset]).toBe(index === 0 ? 1 : 0)
      offset += 1
      const length = view.getUint16(offset, true)
      offset += 2 + length
    }

    expect(new TextDecoder().decode(payload.slice(0, 4))).toBe('AVCD')
    expect(view.getFloat64(6, true)).toBe(50_000_000)
    expect(view.getUint32(14, true)).toBe(4)
    expect(Array.from(payload.slice(offset))).toEqual([1, 0, 1, 2])
  })

  it('rejects empty captures', () => {
    expect(() =>
      buildWaveformVcdPayload({ signals: [], tracks: {}, sampleRateHz: 0 }, 'wave.vcd'),
    ).toThrow('No waveform samples')
  })
})
