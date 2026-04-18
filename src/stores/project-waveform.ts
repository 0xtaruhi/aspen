import { ref } from 'vue'

import {
  cloneProjectWaveformViewSnapshot,
  emptyProjectWaveformViewSnapshot,
  normalizeProjectWaveformViewSnapshot,
  type ProjectWaveformViewSnapshot,
} from './project-model'

const snapshotRevision = ref(0)
const signalOrder = ref<string[]>([])
const signalColorOverrides = ref<Record<string, string>>({})

function applySnapshot(snapshot: ProjectWaveformViewSnapshot) {
  signalOrder.value = [...snapshot.signalOrder]
  signalColorOverrides.value = { ...snapshot.signalColorOverrides }
  snapshotRevision.value += 1
}

function setSnapshot(snapshot: unknown) {
  applySnapshot(normalizeProjectWaveformViewSnapshot(snapshot))
}

function resetState() {
  applySnapshot(emptyProjectWaveformViewSnapshot())
}

function toSnapshot(): ProjectWaveformViewSnapshot {
  return cloneProjectWaveformViewSnapshot({
    version: 1,
    signalOrder: signalOrder.value,
    signalColorOverrides: signalColorOverrides.value,
  })
}

function setSignalOrder(nextSignalOrder: readonly string[]) {
  const nextSnapshot = normalizeProjectWaveformViewSnapshot({
    version: 1,
    signalOrder: [...nextSignalOrder],
    signalColorOverrides: signalColorOverrides.value,
  })

  const currentSnapshot = toSnapshot()
  if (
    JSON.stringify(nextSnapshot.signalOrder) === JSON.stringify(currentSnapshot.signalOrder) &&
    JSON.stringify(nextSnapshot.signalColorOverrides) ===
      JSON.stringify(currentSnapshot.signalColorOverrides)
  ) {
    return
  }

  applySnapshot(nextSnapshot)
}

function setSignalColor(signal: string, color: string) {
  const trimmedSignal = signal.trim()
  const trimmedColor = color.trim()
  if (!trimmedSignal || !trimmedColor) {
    return
  }

  const nextOverrides = {
    ...signalColorOverrides.value,
    [trimmedSignal]: trimmedColor,
  }

  if (nextOverrides[trimmedSignal] === signalColorOverrides.value[trimmedSignal]) {
    return
  }

  applySnapshot({
    version: 1,
    signalOrder: signalOrder.value,
    signalColorOverrides: nextOverrides,
  })
}

function resetSignalColor(signal: string) {
  const trimmedSignal = signal.trim()
  if (!trimmedSignal || !(trimmedSignal in signalColorOverrides.value)) {
    return
  }

  const nextOverrides = { ...signalColorOverrides.value }
  delete nextOverrides[trimmedSignal]

  applySnapshot({
    version: 1,
    signalOrder: signalOrder.value,
    signalColorOverrides: nextOverrides,
  })
}

resetState()

export const projectWaveformStore = {
  snapshotRevision,
  signalOrder,
  signalColorOverrides,
  setSnapshot,
  resetState,
  toSnapshot,
  setSignalOrder,
  setSignalColor,
  resetSignalColor,
}
