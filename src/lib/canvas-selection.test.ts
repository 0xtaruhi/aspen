import { describe, expect, it } from 'vitest'

import {
  buildDraggedPositions,
  collectIntersectingBoundsIds,
  normalizeCanvasRect,
  snapDraggedPositions,
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
})
