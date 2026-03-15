export type ImplementationPlaceMode = 'timing_driven' | 'bounding_box'
export type ImplementationRouteMode = 'timing_driven' | 'direct_search' | 'breadth_first'

export type ImplementationSettingsSnapshot = {
  version: 1
  placeMode: ImplementationPlaceMode
  routeMode: ImplementationRouteMode
}

export const defaultImplementationSettings: ImplementationSettingsSnapshot = {
  version: 1,
  placeMode: 'timing_driven',
  routeMode: 'timing_driven',
}

function isImplementationPlaceMode(value: unknown): value is ImplementationPlaceMode {
  return value === 'timing_driven' || value === 'bounding_box'
}

function isImplementationRouteMode(value: unknown): value is ImplementationRouteMode {
  return value === 'timing_driven' || value === 'direct_search' || value === 'breadth_first'
}

export function cloneImplementationSettings(
  snapshot: ImplementationSettingsSnapshot,
): ImplementationSettingsSnapshot {
  return {
    version: 1,
    placeMode: snapshot.placeMode,
    routeMode: snapshot.routeMode,
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
  const legacyRouteMode =
    record.routeMode === 'timing-driven'
      ? 'timing_driven'
      : record.routeMode === 'direct-search'
        ? 'direct_search'
        : record.routeMode === 'breadth-first'
          ? 'breadth_first'
          : record.routeMode

  return {
    version: 1,
    placeMode: isImplementationPlaceMode(legacyPlaceMode)
      ? legacyPlaceMode
      : defaultImplementationSettings.placeMode,
    routeMode: isImplementationRouteMode(legacyRouteMode)
      ? legacyRouteMode
      : defaultImplementationSettings.routeMode,
  }
}
