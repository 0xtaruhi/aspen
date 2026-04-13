import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'

import { toRaw } from 'vue'

function toPlainCloneable<T>(value: T): T {
  const rawValue = toRaw(value)

  if (Array.isArray(rawValue)) {
    return rawValue.map((entry) => toPlainCloneable(entry)) as T
  }

  if (rawValue && typeof rawValue === 'object') {
    return Object.fromEntries(
      Object.entries(rawValue).map(([key, entry]) => [key, toPlainCloneable(entry)]),
    ) as T
  }

  return rawValue
}

export function cloneCanvasDeviceSnapshot(device: CanvasDeviceSnapshot): CanvasDeviceSnapshot {
  const cloneable = toPlainCloneable(device)
  if (typeof structuredClone === 'function') {
    return structuredClone(cloneable)
  }

  return JSON.parse(JSON.stringify(cloneable)) as CanvasDeviceSnapshot
}

export function cloneCanvasDeviceSnapshots(
  devices: readonly CanvasDeviceSnapshot[] = [],
): CanvasDeviceSnapshot[] {
  return devices.map((device) => cloneCanvasDeviceSnapshot(device))
}
