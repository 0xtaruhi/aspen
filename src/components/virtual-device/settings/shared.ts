import type {
  CanvasDeviceBindingSnapshot,
  CanvasDeviceSnapshot,
  CanvasHd44780BusMode,
  CanvasVgaColorMode,
} from '@/lib/hardware-client'
import { vgaColorModeBitCounts } from '@/lib/canvas-devices'
import type { IndexedSignalBus } from '@/components/virtual-device/types'

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

export function guessIndexedBus(
  indexedBuses: readonly IndexedSignalBus[],
  minimumWidth: number,
  keywords: readonly string[],
  excludeBaseName?: string,
) {
  const narrowed = indexedBuses.filter((bus) => {
    return bus.width >= minimumWidth && bus.baseName !== excludeBaseName
  })

  for (const keyword of keywords) {
    const match = narrowed.find((bus) => bus.baseName.toLowerCase().includes(keyword))
    if (match) {
      return match.baseName
    }
  }

  return narrowed[0]?.baseName ?? ''
}

export function vgaSlotCount(mode: CanvasVgaColorMode) {
  const { redBits, greenBits, blueBits } = vgaColorModeBitCounts(mode)
  return 2 + redBits + greenBits + blueBits
}

export function hd44780SlotCount(mode: CanvasHd44780BusMode) {
  return 3 + (mode === '8bit' ? 8 : 4)
}

export function basenameFromPath(path: string | null | undefined) {
  if (!path) {
    return null
  }

  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}
