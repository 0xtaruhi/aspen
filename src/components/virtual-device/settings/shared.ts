import type {
  CanvasDeviceBindingSnapshot,
  CanvasDeviceSnapshot,
  CanvasHd44780BusMode,
  CanvasMemoryMode,
  CanvasVgaColorMode,
} from '@/lib/hardware-client'
import { CANVAS_MEMORY_MAX_ADDRESS_WIDTH, vgaColorModeBitCounts } from '@/lib/canvas-devices'
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

export function memorySlotCount(mode: CanvasMemoryMode, addressWidth: number, dataWidth: number) {
  if (mode === 'rom') {
    return addressWidth + dataWidth + 2
  }

  return addressWidth + dataWidth + dataWidth + 3
}

export function memoryWordCount(addressWidth: number) {
  return 1 << Math.min(addressWidth, CANVAS_MEMORY_MAX_ADDRESS_WIDTH)
}

export function requiredMemoryAddressWidth(wordCount: number) {
  if (wordCount <= 1) {
    return 1
  }

  return Math.min(CANVAS_MEMORY_MAX_ADDRESS_WIDTH, Math.max(1, Math.ceil(Math.log2(wordCount))))
}

export function memoryHexWidth(bits: number) {
  return Math.max(2, Math.ceil(bits / 4))
}

export function formatMemoryAddress(index: number, addressWidth: number) {
  return index.toString(16).toUpperCase().padStart(memoryHexWidth(addressWidth), '0')
}

export function formatMemoryWord(value: number, dataWidth: number) {
  return (value ?? 0).toString(16).toUpperCase().padStart(memoryHexWidth(dataWidth), '0')
}

export function basenameFromPath(path: string | null | undefined) {
  if (!path) {
    return null
  }

  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
}
