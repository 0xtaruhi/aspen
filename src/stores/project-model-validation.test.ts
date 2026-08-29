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

  it.each([Number.NaN, -1, 256, 1.5])('discards invalid transient byte payload %j', (byte) => {
    const terminal = createCanvasDeviceSnapshot('uart_terminal', 'uart', 0, 0, 0)
    terminal.state.data = { kind: 'queued_bytes', bytes: [byte] }

    expect(normalizeProjectCanvasDevices([terminal])).toMatchObject([
      { id: 'uart', state: { data: { kind: 'none' } } },
    ])
  })

  it('discards invalid transient encoder state without removing the device', () => {
    const encoder = createCanvasDeviceSnapshot('quadrature_encoder', 'encoder', 0, 0, 0)
    encoder.state.data = { kind: 'quadrature_encoder', phase: 4, button_pressed: false }

    expect(normalizeProjectCanvasDevices([encoder])).toMatchObject([
      { id: 'encoder', state: { data: { kind: 'none' } } },
    ])
  })

  it('rejects invalid data for device types that persist it', () => {
    const switches = createCanvasDeviceSnapshot('dip_switch_bank', 'switches', 0, 0, 0)
    const invalidSwitches = {
      ...switches,
      state: {
        ...switches.state,
        data: { kind: 'bitset', bits: [true, 1] },
      },
    }

    expect(normalizeProjectCanvasDevices([invalidSwitches])).toEqual([])
  })
})
