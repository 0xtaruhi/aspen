import { describe, expect, it } from 'vitest'

import {
  appendCanvasDeviceText,
  rotateCanvasDeviceEncoder,
  setCanvasDeviceBit,
  setCanvasDeviceEncoderButton,
} from '@/lib/canvas-device-actions'
import { createCanvasDeviceSnapshot } from '@/lib/canvas-devices'

describe('canvas device actions', () => {
  it('appends UTF-8 terminal input without mutating the source snapshot', () => {
    const device = createCanvasDeviceSnapshot('uart_terminal', 'uart', 0, 0, 0)
    const first = appendCanvasDeviceText(device, 'A')
    const second = appendCanvasDeviceText(first, '中')

    expect(device.state.data).toEqual({ kind: 'queued_bytes', bytes: [] })
    expect(second.state.data).toEqual({
      kind: 'queued_bytes',
      bytes: [65, 0xe4, 0xb8, 0xad],
    })
  })

  it('updates a DIP switch bit and ignores out-of-range indexes', () => {
    const device = createCanvasDeviceSnapshot('dip_switch_bank', 'dip', 0, 0, 0)
    const updated = setCanvasDeviceBit(device, 2, true)
    const outOfRange = setCanvasDeviceBit(updated, 100, true)

    expect(updated.state.data).toMatchObject({ kind: 'bitset' })
    expect(updated.state.data.kind === 'bitset' ? updated.state.data.bits : []).toHaveLength(8)
    expect(updated.state.data.kind === 'bitset' ? updated.state.data.bits[2] : false).toBe(true)
    expect(outOfRange.state.data).toEqual(updated.state.data)
  })

  it('wraps encoder phases in both directions and preserves button state', () => {
    const device = createCanvasDeviceSnapshot('quadrature_encoder', 'encoder', 0, 0, 0)
    const pressed = setCanvasDeviceEncoderButton(device, true)
    const rotated = rotateCanvasDeviceEncoder(pressed, -1)

    expect(rotated.state.data).toEqual({
      kind: 'quadrature_encoder',
      phase: 3,
      button_pressed: true,
    })
  })
})
