import { describe, expect, it } from 'vitest'

import { createCanvasDeviceSnapshot } from '@/lib/canvas-devices'

import { remapCanvasSlotBindings } from './shared'

describe('virtual device setting binding remaps', () => {
  it('keeps LED matrix row and column groups aligned when row count changes', () => {
    const device = createCanvasDeviceSnapshot('led_matrix', 'matrix', 0, 0, 0)
    device.state.binding = {
      kind: 'slots',
      signals: [
        'row0',
        'row1',
        'row2',
        'row3',
        'row4',
        'row5',
        'row6',
        'row7',
        'col0',
        'col1',
        'col2',
        'col3',
        'col4',
        'col5',
        'col6',
        'col7',
      ],
    }

    expect(
      remapCanvasSlotBindings(device, {
        kind: 'led_matrix',
        rows: 4,
        columns: 8,
        row_active_low: false,
        column_active_low: true,
      }),
    ).toEqual({
      kind: 'slots',
      signals: [
        'row0',
        'row1',
        'row2',
        'row3',
        'col0',
        'col1',
        'col2',
        'col3',
        'col4',
        'col5',
        'col6',
        'col7',
      ],
    })
  })

  it('keeps HD44780 data bits attached to their named slots', () => {
    const device = createCanvasDeviceSnapshot('hd44780_lcd', 'lcd', 0, 0, 0)
    device.state.binding = {
      kind: 'slots',
      signals: ['rs', 'e', 'rw', 'd4', 'd5', 'd6', 'd7'],
    }

    expect(
      remapCanvasSlotBindings(device, {
        kind: 'hd44780_lcd',
        columns: 16,
        rows: 2,
        bus_mode: '8bit',
      }),
    ).toEqual({
      kind: 'slots',
      signals: ['rs', 'e', 'rw', null, null, null, null, 'd4', 'd5', 'd6', 'd7'],
    })
  })

  it('keeps VGA color channels separated when color width changes', () => {
    const device = createCanvasDeviceSnapshot('vga_display', 'vga', 0, 0, 0)
    device.state.binding = {
      kind: 'slots',
      signals: ['hs', 'vs', 'r0', 'r1', 'r2', 'g0', 'g1', 'g2', 'b0', 'b1'],
    }

    expect(
      remapCanvasSlotBindings(device, {
        kind: 'vga_display',
        columns: 640,
        rows: 480,
        color_mode: 'rgb444',
        hsync_active_low: true,
        vsync_active_low: true,
      }),
    ).toEqual({
      kind: 'slots',
      signals: ['hs', 'vs', 'r0', 'r1', 'r2', null, 'g0', 'g1', 'g2', null, 'b0', 'b1', null, null],
    })
  })

  it('keeps UART direction bindings when changing modes', () => {
    const device = createCanvasDeviceSnapshot('uart_terminal', 'uart', 0, 0, 0)
    device.state.binding = { kind: 'slots', signals: ['rx', 'tx'] }

    expect(
      remapCanvasSlotBindings(device, {
        kind: 'uart_terminal',
        cycles_per_bit: 16,
        mode: 'tx',
      }),
    ).toEqual({ kind: 'slots', signals: ['tx'] })
  })
})
