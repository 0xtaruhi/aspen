export type CanvasPoint = {
  x: number
  y: number
}

export type CanvasRect = {
  x: number
  y: number
  width: number
  height: number
}

export type CanvasBounds = CanvasRect & {
  id: string
}

export function snapToGrid(value: number, gridSize: number): number {
  if (gridSize <= 0) {
    return value
  }

  return Math.round(value / gridSize) * gridSize
}

export function normalizeCanvasRect(start: CanvasPoint, end: CanvasPoint): CanvasRect {
  const left = Math.min(start.x, end.x)
  const top = Math.min(start.y, end.y)

  return {
    x: left,
    y: top,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  }
}

export function rectsIntersect(a: CanvasRect, b: CanvasRect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

export function collectIntersectingBoundsIds(
  selectionRect: CanvasRect,
  bounds: readonly CanvasBounds[],
): string[] {
  return bounds.filter((bound) => rectsIntersect(selectionRect, bound)).map((bound) => bound.id)
}

export function buildDraggedPositions(
  selectedIds: readonly string[],
  startPositions: Readonly<Record<string, CanvasPoint>>,
  leaderId: string,
  leaderPosition: CanvasPoint,
): Record<string, CanvasPoint> {
  const leaderStart = startPositions[leaderId]
  if (!leaderStart) {
    return {}
  }

  const deltaX = leaderPosition.x - leaderStart.x
  const deltaY = leaderPosition.y - leaderStart.y

  return Object.fromEntries(
    selectedIds
      .filter((id) => Boolean(startPositions[id]))
      .map((id) => {
        const start = startPositions[id]
        return [
          id,
          {
            x: start.x + deltaX,
            y: start.y + deltaY,
          },
        ]
      }),
  )
}

export function snapDraggedPositions(
  selectedIds: readonly string[],
  startPositions: Readonly<Record<string, CanvasPoint>>,
  leaderId: string,
  leaderPosition: CanvasPoint,
  gridSize: number,
): Record<string, CanvasPoint> {
  const leaderStart = startPositions[leaderId]
  if (!leaderStart) {
    return {}
  }

  const snappedLeaderX = snapToGrid(leaderPosition.x, gridSize)
  const snappedLeaderY = snapToGrid(leaderPosition.y, gridSize)

  return buildDraggedPositions(selectedIds, startPositions, leaderId, {
    x: snappedLeaderX,
    y: snappedLeaderY,
  })
}
