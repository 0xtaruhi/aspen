import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import {
  getCanvasBitsetData,
  getCanvasDipSwitchBankConfig,
  getCanvasQuadratureEncoderData,
} from '@/lib/canvas-devices'

function updateDeviceData(
  device: CanvasDeviceSnapshot,
  data: CanvasDeviceSnapshot['state']['data'],
): CanvasDeviceSnapshot {
  return {
    ...device,
    state: {
      ...device.state,
      data,
    },
  }
}

export function appendCanvasDeviceText(
  device: CanvasDeviceSnapshot,
  value: string,
): CanvasDeviceSnapshot {
  const bytes = Array.from(new TextEncoder().encode(value))
  const existing = device.state.data.kind === 'queued_bytes' ? device.state.data.bytes : []
  return updateDeviceData(device, {
    kind: 'queued_bytes',
    bytes: [...existing, ...bytes],
  })
}

export function setCanvasDeviceBit(
  device: CanvasDeviceSnapshot,
  index: number,
  value: boolean,
): CanvasDeviceSnapshot {
  const width = getCanvasDipSwitchBankConfig(device)?.width ?? 1
  const bits = getCanvasBitsetData(device, width)
  if (index >= 0 && index < bits.length) {
    bits[index] = value
  }

  return updateDeviceData(device, { kind: 'bitset', bits })
}

export function rotateCanvasDeviceEncoder(
  device: CanvasDeviceSnapshot,
  delta: number,
): CanvasDeviceSnapshot {
  const data = getCanvasQuadratureEncoderData(device)
  return updateDeviceData(device, {
    kind: 'quadrature_encoder',
    phase: (((data.phase + delta) % 4) + 4) % 4,
    button_pressed: data.buttonPressed,
  })
}

export function setCanvasDeviceEncoderButton(
  device: CanvasDeviceSnapshot,
  value: boolean,
): CanvasDeviceSnapshot {
  const data = getCanvasQuadratureEncoderData(device)
  return updateDeviceData(device, {
    kind: 'quadrature_encoder',
    phase: data.phase,
    button_pressed: value,
  })
}

export function setCanvasDeviceMatrixKey(
  device: CanvasDeviceSnapshot,
  row: number | null,
  column: number | null,
): CanvasDeviceSnapshot {
  return updateDeviceData(device, {
    kind: 'matrix_keypad',
    pressed_row: row,
    pressed_column: column,
  })
}
