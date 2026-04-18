export function trimSignalName(signal: string) {
  return signal.trim()
}

export function trimSignalNames(signals: readonly string[]) {
  return signals.map(trimSignalName)
}

export function normalizeUniqueSignalNames(signals: readonly string[]) {
  const seen = new Set<string>()
  const normalized: string[] = []

  for (const signal of signals) {
    const nextSignal = trimSignalName(signal)
    if (!nextSignal || seen.has(nextSignal)) {
      continue
    }

    seen.add(nextSignal)
    normalized.push(nextSignal)
  }

  return normalized
}

export function equalStringArrays(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((value, index) => value === right[index])
}

export function equalStringRecords(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
) {
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  if (!equalStringArrays(leftKeys, rightKeys)) {
    return false
  }

  return leftKeys.every((key) => left[key] === right[key])
}
