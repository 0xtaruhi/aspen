import { describe, expect, it } from 'vitest'

import { createCanvasDeviceSnapshot } from '@/lib/canvas-devices'

import { normalizeProjectCanvasDevices } from './project-model-validation'

describe('project model validation', () => {
  it('accepts valid device input state and returns a detached snapshot', () => {
    const terminal = createCanvasDeviceSnapshot('uart_terminal', 'uart', 0, 0, 0)
    terminal.state.data = { kind: 'queued_bytes', bytes: [0, 127, 255] }

    const normalized = normalizeProjectCanvasDevices([terminal])

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).not.toBe(terminal)
    expect(terminal.state.data).toEqual({ kind: 'queued_bytes', bytes: [0, 127, 255] })
    expect(normalized[0]?.state.data).toEqual({ kind: 'none' })
  })

  it.each([Number.NaN, -1, 256, 1.5])('rejects invalid queued byte payload %j', (byte) => {
    const terminal = createCanvasDeviceSnapshot('uart_terminal', 'uart', 0, 0, 0)
    terminal.state.data = { kind: 'queued_bytes', bytes: [byte] }

    expect(normalizeProjectCanvasDevices([terminal])).toEqual([])
  })

  it('rejects partial matrix key coordinates and invalid encoder phases', () => {
    const keypad = createCanvasDeviceSnapshot('matrix_keypad', 'keypad', 0, 0, 0)
    keypad.state.data = { kind: 'matrix_keypad', pressed_row: 1, pressed_column: null }
    const encoder = createCanvasDeviceSnapshot('quadrature_encoder', 'encoder', 0, 0, 0)
    encoder.state.data = { kind: 'quadrature_encoder', phase: 4, button_pressed: false }

    expect(normalizeProjectCanvasDevices([keypad, encoder])).toEqual([])
  })
})
