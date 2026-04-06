import { describe, expect, it } from 'vitest'

import { buildTimingSearchAliases, parseTimingReportPaths } from './netlist-timing-path'

describe('netlist timing path parser', () => {
  it('parses startpoint, endpoint, slack, and tabular path steps', () => {
    const report = `
Startpoint: top/u_reg/Q
Endpoint: top/out_reg/D
Slack: -0.42

Point                            Delay      Arrival
top/u_reg/Q                      0.00       0.00
top/u_lut/Y                      0.14       0.14
top/out_reg/D                    0.28       0.42
`

    const [path] = parseTimingReportPaths(report)

    expect(path?.startpoint).toBe('top/u_reg/Q')
    expect(path?.endpoint).toBe('top/out_reg/D')
    expect(path?.slackValue).toBe(-0.42)
    expect(path?.steps.map((step) => step.label)).toEqual([
      'top/u_reg/Q',
      'top/u_lut/Y',
      'top/out_reg/D',
    ])
  })

  it('parses arrow-formatted paths', () => {
    const report = `
Critical Path
clk -> top/u0/Q -> top/u1/A -> top/u1/Y -> led
Slack -0.08
`

    const [path] = parseTimingReportPaths(report)

    expect(path?.title).toBe('clk -> led')
    expect(path?.steps.map((step) => step.label)).toEqual([
      'clk',
      'top/u0/Q',
      'top/u1/A',
      'top/u1/Y',
      'led',
    ])
  })

  it('builds fallback aliases for hierarchical timing labels', () => {
    expect(buildTimingSearchAliases('top/u_ff0/Q', 'top')).toEqual([
      'top/u_ff0/Q',
      'u_ff0/Q',
      'Q',
      'u_ff0',
      'top/u_ff0',
    ])
    expect(buildTimingSearchAliases('\\top.signal[0]', 'top')).toEqual([
      '\\top.signal[0]',
      'top.signal[0]',
      'signal[0]',
      '\\top.signal',
    ])
  })
})
