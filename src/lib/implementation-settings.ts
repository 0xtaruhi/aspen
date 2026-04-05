export type ImplementationPlaceMode = 'timing_driven' | 'bounding_box'

export type ImplementationSettingsSnapshot = {
  version: 1
  placeMode: ImplementationPlaceMode
}

export const defaultImplementationSettings: ImplementationSettingsSnapshot = {
  version: 1,
  placeMode: 'timing_driven',
}

function isImplementationPlaceMode(value: unknown): value is ImplementationPlaceMode {
  return value === 'timing_driven' || value === 'bounding_box'
}

export function cloneImplementationSettings(
  snapshot: ImplementationSettingsSnapshot,
): ImplementationSettingsSnapshot {
  return {
    version: 1,
    placeMode: snapshot.placeMode,
  }
}

export function normalizeImplementationSettings(value: unknown): ImplementationSettingsSnapshot {
  if (!value || typeof value !== 'object') {
    return cloneImplementationSettings(defaultImplementationSettings)
  }

  const record = value as Record<string, unknown>
  const legacyPlaceMode =
    record.placeMode === 'timing-driven'
      ? 'timing_driven'
      : record.placeMode === 'bounding-box'
        ? 'bounding_box'
        : record.placeMode

  return {
    version: 1,
    placeMode: isImplementationPlaceMode(legacyPlaceMode)
      ? legacyPlaceMode
      : defaultImplementationSettings.placeMode,
  }
}
