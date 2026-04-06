import { describe, expect, it } from 'vitest'

import { createCanvasDeviceSnapshot, getCanvasDeviceBindingSlots } from './canvas-devices'

describe('memory device binding slots', () => {
  it('does not expose DIN or WE for ROM devices', () => {
    const device = createCanvasDeviceSnapshot('memory', 'rom-1', 0, 0, 1)
    device.state.config = {
      kind: 'memory',
      mode: 'rom',
      address_width: 4,
      data_width: 8,
    }

    const labels = getCanvasDeviceBindingSlots(device).map((slot) => slot.label)

    expect(labels).toEqual([
      'A0',
      'A1',
      'A2',
      'A3',
      'DOUT0',
      'DOUT1',
      'DOUT2',
      'DOUT3',
      'DOUT4',
      'DOUT5',
      'DOUT6',
      'DOUT7',
      'CS',
      'OE',
    ])
  })

  it('keeps DIN and WE for RAM devices', () => {
    const device = createCanvasDeviceSnapshot('memory', 'ram-1', 0, 0, 1)
    device.state.config = {
      kind: 'memory',
      mode: 'ram',
      address_width: 2,
      data_width: 4,
    }

    const labels = getCanvasDeviceBindingSlots(device).map((slot) => slot.label)

    expect(labels).toEqual([
      'A0',
      'A1',
      'DIN0',
      'DIN1',
      'DIN2',
      'DIN3',
      'DOUT0',
      'DOUT1',
      'DOUT2',
      'DOUT3',
      'CS',
      'OE',
      'WE',
    ])
  })
})
