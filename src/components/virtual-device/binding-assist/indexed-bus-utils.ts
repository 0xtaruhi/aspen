import type { IndexedBusBindingGroup, IndexedSignalBus } from '@/components/virtual-device/types'

type IndexedSignalSource = {
  name: string
  bindingLabel: string
}

type IndexedBusAccumulator = {
  kind: 'scalar' | 'indexed'
  maxIndex: number
  signals: Map<number, string>
  scalarLabel: string | null
}

export function buildIndexedSignalBuses(
  signals: readonly IndexedSignalSource[],
): IndexedSignalBus[] {
  const buses = new Map<string, IndexedBusAccumulator>()

  for (const signal of signals) {
    const match = signal.name.match(/^(.*)\[(\d+)\]$/)
    if (!match) {
      if (!buses.has(signal.name)) {
        buses.set(signal.name, {
          kind: 'scalar',
          maxIndex: 0,
          signals: new Map([[0, signal.name]]),
          scalarLabel: signal.bindingLabel,
        })
      }
      continue
    }

    const baseName = match[1]
    const bitIndex = Number.parseInt(match[2], 10)
    if (Number.isNaN(bitIndex)) {
      continue
    }

    const existing = buses.get(baseName) ?? {
      kind: 'indexed' as const,
      maxIndex: -1,
      signals: new Map<number, string>(),
      scalarLabel: null,
    }

    existing.kind = 'indexed'
    existing.maxIndex = Math.max(existing.maxIndex, bitIndex)
    existing.signals.set(bitIndex, signal.name)
    buses.set(baseName, existing)
  }

  return [...buses.entries()]
    .map(([baseName, bus]) => {
      const width = bus.maxIndex + 1
      return {
        baseName,
        label:
          bus.kind === 'scalar' ? (bus.scalarLabel ?? baseName) : `${baseName}[0:${width - 1}]`,
        width,
        signals: Array.from({ length: width }, (_, index) => bus.signals.get(index) ?? null),
      }
    })
    .sort((left, right) => left.baseName.localeCompare(right.baseName))
}

export function applySelectedIndexedBusGroups(options: {
  currentSignals: readonly (string | null)[]
  groups: readonly IndexedBusBindingGroup[]
  selections: Readonly<Record<string, string>>
  buses: readonly IndexedSignalBus[]
}) {
  const nextSignals = [...options.currentSignals]
  const busMap = new Map(options.buses.map((bus) => [bus.baseName, bus]))
  let appliedGroupCount = 0

  for (const group of options.groups) {
    const selectedBaseName = options.selections[group.key]
    if (!selectedBaseName) {
      continue
    }

    const bus = busMap.get(selectedBaseName)
    if (!bus || bus.width < group.width) {
      continue
    }

    for (let index = 0; index < group.width; index += 1) {
      nextSignals[group.slotOffset + index] = bus.signals[index] ?? null
    }

    appliedGroupCount += 1
  }

  return {
    nextSignals,
    appliedGroupCount,
  }
}
