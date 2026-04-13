import { describe, expect, it } from 'vitest'

import {
  computeStreamScheduleLagMs,
  formatActualHz,
  formatRate,
  median,
  shouldWarnStreamBacklog,
} from './stream-helpers'

describe('virtual device stream helpers', () => {
  it('formats configured stream rates for the toolbar input', () => {
    expect(formatRate(1000)).toBe('1000')
    expect(formatRate(1000.5)).toBe('1000.5')
    expect(formatRate(0)).toBe('1')
  })

  it('formats actual stream rates across units', () => {
    expect(formatActualHz(0)).toBe('0 Hz')
    expect(formatActualHz(992.4)).toBe('992 Hz')
    expect(formatActualHz(12_500)).toBe('12.5 kHz')
    expect(formatActualHz(345_678)).toBe('346 kHz')
    expect(formatActualHz(1_540_000)).toBe('1.54 MHz')
  })

  it('computes stable median values for the display smoother', () => {
    expect(median([])).toBe(0)
    expect(median([5, 1, 3])).toBe(3)
    expect(median([10, 4, 8, 12])).toBe(9)
  })

  it('warns only when backlog exceeds the lag threshold', () => {
    const lagMs = computeStreamScheduleLagMs(16, 1000)
    expect(lagMs).toBe(16)
    expect(shouldWarnStreamBacklog(16, lagMs)).toBe(true)
    expect(shouldWarnStreamBacklog(1, computeStreamScheduleLagMs(1, 1000))).toBe(false)
  })
})
