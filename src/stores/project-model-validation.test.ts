import { describe, expect, it } from 'vitest'

import { createCanvasDeviceSnapshot } from '@/lib/canvas-devices'

import { normalizeProjectCanvasDevices } from './project-model-validation'

describe('project model validation', () => {
  it('accepts valid device input state and returns a detached snapshot', () => {
    const terminal = createCanvasDeviceSnapshot('uart_terminal', 'uart', 0, 0, 0)
    terminal.state.data = { kind: 'queued_bytes', bytes: [0, 127, 255], generation: 4 }

    const normalized = normalizeProjectCanvasDevices([terminal])

    expect(normalized).toHaveLength(1)
    expect(normalized[0]).not.toBe(terminal)
    expect(terminal.state.data).toEqual({
      kind: 'queued_bytes',
      bytes: [0, 127, 255],
      generation: 4,
    })
    expect(normalized[0]?.state.data).toEqual({ kind: 'none' })
  })

  it.each([Number.NaN, -1, 256, 1.5])('discards invalid transient byte payload %j', (byte) => {
    const terminal = createCanvasDeviceSnapshot('uart_terminal', 'uart', 0, 0, 0)
    terminal.state.data = { kind: 'queued_bytes', bytes: [byte], generation: 1 }

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

  it('migrates legacy segment polarity and unsupported LCD geometry', () => {
    const segment = createCanvasDeviceSnapshot('segment_display', 'segment', 0, 0, 0)
    segment.state.config = {
      kind: 'segment_display',
      digits: 4,
      active_low: true,
      digit_active_low: true,
    }
    delete (segment.state.config as Partial<typeof segment.state.config>).digit_active_low

    const lcd = createCanvasDeviceSnapshot('hd44780_lcd', 'lcd', 0, 0, 1)
    lcd.state.config = {
      kind: 'hd44780_lcd',
      columns: 40,
      rows: 4,
      bus_mode: '4bit',
    }

    const normalized = normalizeProjectCanvasDevices([segment, lcd])

    expect(normalized[0]?.state.config).toEqual({
      kind: 'segment_display',
      digits: 4,
      active_low: true,
      digit_active_low: true,
    })
    expect(normalized[1]?.state.config).toEqual({
      kind: 'hd44780_lcd',
      columns: 20,
      rows: 4,
      bus_mode: '4bit',
    })
  })
})
