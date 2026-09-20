import type {
  CanvasDeviceBindingSnapshot,
  CanvasDeviceConfigSnapshot,
  CanvasDeviceSnapshot,
} from '@/lib/hardware-client'
import { getCanvasDeviceBindingSlots } from '@/lib/canvas-devices'

export function clampInspectorInt(
  value: string | number | null | undefined,
  fallback: number,
  min = 1,
  max = 1024,
) {
  const raw = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(raw)) {
    return fallback
  }

  return Math.max(min, Math.min(max, Math.trunc(raw)))
}

export function resizeCanvasSlotBindings(
  device: CanvasDeviceSnapshot,
  count: number,
): CanvasDeviceBindingSnapshot {
  const nextSignals = Array.from({ length: count }, (_, index) => {
    if (device.state.binding.kind !== 'slots') {
      return null
    }

    return device.state.binding.signals[index] ?? null
  })

  return {
    kind: 'slots',
    signals: nextSignals,
  }
}

export function remapCanvasSlotBindings(
  device: CanvasDeviceSnapshot,
  nextConfig: CanvasDeviceConfigSnapshot,
): CanvasDeviceBindingSnapshot {
  if (device.state.binding.kind !== 'slots') {
    return { kind: 'slots', signals: [] }
  }

  const currentSignals = device.state.binding.signals
  const currentSlots = getCanvasDeviceBindingSlots(device)
  const currentSignalsByKey = new Map(
    currentSlots.map((slot, index) => [slot.key, currentSignals[index] ?? null]),
  )
  const nextDevice: CanvasDeviceSnapshot = {
    ...device,
    state: {
      ...device.state,
      config: nextConfig,
    },
  }

  return {
    kind: 'slots',
    signals: getCanvasDeviceBindingSlots(nextDevice).map(
      (slot) => currentSignalsByKey.get(slot.key) ?? null,
    ),
  }
}

export function replaceCanvasSlotBindings(
  device: CanvasDeviceSnapshot,
  signals: readonly (string | null)[],
): CanvasDeviceSnapshot {
  if (device.state.binding.kind !== 'slots') {
    return device
  }

  return {
    ...device,
    state: {
      ...device.state,
      binding: {
        kind: 'slots',
        signals: [...signals],
      },
    },
  }
}

export function basenameFromPath(path: string | null | undefined) {
  if (!path) {
    return null
  }

  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}
