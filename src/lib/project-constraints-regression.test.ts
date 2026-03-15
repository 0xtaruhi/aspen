import { describe, expect, it } from 'vitest'

import { getFpgaBoardDescriptor } from './fpga-board-catalog'
import {
  autoAssignProjectConstraints,
  buildConstraintXml,
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
      },
    ])

    expect(xml).toContain('<design name="top_module">')
    expect(xml).toContain('<port name="led[0]" position="P7"/>')
    expect(xml).toContain('<port name="clk" position="P77"/>')
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
})
