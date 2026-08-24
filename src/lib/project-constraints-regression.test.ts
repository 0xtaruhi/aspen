import { describe, expect, it } from 'vitest'

import { getFpgaBoardDescriptor } from './fpga-board-catalog'
import {
  autoAssignProjectConstraints,
  buildPhysicalSignalSlotOrder,
  buildConstraintXml,
  isLikelyClockPort,
  resolveCurrentProjectPinConstraints,
} from './project-constraints'
import type { ExpandedVerilogPortBit } from './verilog-port-bits'

const referenceBoard = getFpgaBoardDescriptor('FDP3P7_REFERENCE')

describe('project constraints regression', () => {
  it('prefers the dedicated clock pin when auto-assigning clock-like inputs', () => {
    const ports: ExpandedVerilogPortBit[] = [
      {
        name: 'clk',
        direction: 'input',
        width: '',
        bitName: 'clk',
        baseName: 'clk',
        bitIndex: null,
      },
      {
        name: 'sw',
        direction: 'input',
        width: '',
        bitName: 'sw',
        baseName: 'sw',
        bitIndex: null,
      },
      {
        name: 'led',
        direction: 'output',
        width: '',
        bitName: 'led',
        baseName: 'led',
        bitIndex: null,
      },
    ]

    const assignments = autoAssignProjectConstraints(ports, referenceBoard)

    expect(assignments.find((entry) => entry.portName === 'clk')?.pinId).toBe('P77')
    expect(assignments.find((entry) => entry.portName === 'clk')?.clockPeriodNs).toBeCloseTo(
      1000 / 30,
    )
    expect(assignments.find((entry) => entry.portName === 'sw')?.pinId).not.toBe('P77')
  })

  it('exports the current top-level assignments as constraint xml', () => {
    const xml = buildConstraintXml('top_module', [
      {
        portName: 'led[0]',
        pinId: 'P7',
      },
      {
        portName: 'clk',
        pinId: 'P77',
        clockPeriodNs: 1000 / 30,
      },
    ])

    expect(xml).toContain('<design name="top_module">')
    expect(xml).toContain('<port name="led[0]" position="P7"/>')
    expect(xml).toContain('<port name="clk" position="P77"/>')
    expect(xml).toContain('<clock name="clk" port="clk" period="33.333333"/>')
  })

  it('omits invalid clock periods from constraint xml', () => {
    const xml = buildConstraintXml('top_module', [
      { portName: 'clk', pinId: 'P77', clockPeriodNs: 0 },
      { portName: 'clock_aux', pinId: 'P151', clockPeriodNs: Number.NaN },
    ])

    expect(xml).not.toContain('<clock')
  })

  it('recognizes common prefixed and suffixed clock names', () => {
    expect(isLikelyClockPort('sys_clk')).toBe(true)
    expect(isLikelyClockPort('clk_50m')).toBe(true)
    expect(isLikelyClockPort('data')).toBe(false)
  })

  it('only exposes assignments that belong to the current top file', () => {
    const ports: ExpandedVerilogPortBit[] = [
      {
        name: 'led',
        direction: 'output',
        width: '',
        bitName: 'led',
        baseName: 'led',
        bitIndex: null,
      },
    ]

    expect(
      resolveCurrentProjectPinConstraints(
        {
          version: 1,
          topFileId: 'top-a',
          assignments: [{ portName: 'led', pinId: 'P7' }],
        },
        'top-b',
        ports,
      ),
    ).toEqual([])
  })

  it('builds physical stream slot orders from board pin order', () => {
    const assignments = [
      { portName: 'jump', pinId: 'P151' },
      { portName: 'pause', pinId: 'P148' },
      { portName: 'resetn', pinId: 'P150' },
      { portName: 'gameover', pinId: 'P110' },
    ]

    expect(buildPhysicalSignalSlotOrder(referenceBoard, assignments, 'input').slice(0, 4)).toEqual([
      'jump',
      'pause',
      'resetn',
      '',
    ])
    expect(
      buildPhysicalSignalSlotOrder(referenceBoard, assignments, 'output').slice(30, 34),
    ).toEqual(['', '', 'gameover', ''])
  })
})
