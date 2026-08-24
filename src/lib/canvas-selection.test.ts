import { describe, expect, it } from 'vitest'

import {
  buildDraggedPositions,
  clampClientPointToCanvas,
  clientToCanvasPoint,
  collectIntersectingBoundsIds,
  hasCanvasPointerMoved,
  isClientPointInsideCanvas,
  normalizeCanvasRect,
  snapDraggedPositions,
  zoomCanvasScale,
} from './canvas-selection'

describe('canvas selection helpers', () => {
  it('normalizes marquee rectangles and finds intersecting devices', () => {
    const selectionRect = normalizeCanvasRect({ x: 120, y: 110 }, { x: 20, y: 10 })

    expect(selectionRect).toEqual({
      x: 20,
      y: 10,
      width: 100,
      height: 100,
    })

    expect(
      collectIntersectingBoundsIds(selectionRect, [
        { id: 'inside', x: 30, y: 20, width: 40, height: 30 },
        { id: 'crossing', x: 100, y: 90, width: 50, height: 50 },
        { id: 'outside', x: 180, y: 180, width: 20, height: 20 },
      ]),
    ).toEqual(['inside', 'crossing'])
  })

  it('moves all selected devices by the dragged leader delta', () => {
    const startPositions = {
      leader: { x: 20, y: 40 },
      follower: { x: 100, y: 140 },
    }

    expect(
      buildDraggedPositions(['leader', 'follower'], startPositions, 'leader', {
        x: 55,
        y: 80,
      }),
    ).toEqual({
      leader: { x: 55, y: 80 },
      follower: { x: 135, y: 180 },
    })
  })

  it('snaps group drags by preserving the relative layout', () => {
    const startPositions = {
      leader: { x: 20, y: 40 },
      follower: { x: 100, y: 140 },
    }

    expect(
      snapDraggedPositions(['leader', 'follower'], startPositions, 'leader', { x: 47, y: 71 }, 20),
    ).toEqual({
      leader: { x: 40, y: 80 },
      follower: { x: 120, y: 180 },
    })
  })

  it('converts, clamps, and bounds-checks pointer coordinates', () => {
    const rect = { left: 100, right: 500, top: 50, bottom: 350, width: 400, height: 300 }
    const viewport = { scale: 2, offset: { x: 20, y: -10 } }

    expect(clientToCanvasPoint(rect, viewport, 180, 100)).toEqual({ x: 30, y: 30 })
    expect(clampClientPointToCanvas(rect, 50, 500)).toEqual({ x: 0, y: 300 })
    expect(isClientPointInsideCanvas(rect, 120, 80, 40)).toBe(false)
    expect(isClientPointInsideCanvas(rect, 120, 100, 40)).toBe(true)
  })

  it('clamps zoom and applies the marquee movement threshold', () => {
    expect(zoomCanvasScale(1, 200)).toBe(0.8)
    expect(zoomCanvasScale(0.1, 1_000)).toBe(0.1)
    expect(zoomCanvasScale(5, -1_000)).toBe(5)
    expect(hasCanvasPointerMoved({ x: 10, y: 10 }, { x: 13, y: 13 }, 4)).toBe(false)
    expect(hasCanvasPointerMoved({ x: 10, y: 10 }, { x: 14, y: 10 }, 4)).toBe(true)
  })
})
