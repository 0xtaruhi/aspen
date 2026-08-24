import { computed, effectScope } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useCanvasDeviceDrag } from './use-canvas-device-drag'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'

const device = {
  id: 'device-1',
  x: 0,
  y: 0,
} as CanvasDeviceSnapshot

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useCanvasDeviceDrag', () => {
  it('clears transient state and reports a rejected position update', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', {
      requestAnimationFrame: (callback: FrameRequestCallback) => callback(0),
      setTimeout,
    })
    const positionFailure = new Error('position write failed')
    const scope = effectScope()
    const drag = scope.run(() =>
      useCanvasDeviceDrag({
        devices: computed(() => [device]),
        selectedDeviceIds: computed(() => []),
        selectedDeviceIdSet: computed(() => new Set<string>()),
        setDevicePosition: vi.fn().mockRejectedValue(positionFailure),
        animationMs: 0,
      }),
    )

    expect(drag).toBeDefined()
    drag?.animateDeviceToPosition(device.id, 20, 40)
    await vi.runAllTimersAsync()

    expect(drag?.transientDevicePositions.value).toEqual({})
    expect(drag?.isDeviceAnimating(device.id)).toBe(false)
    expect(drag?.positionError.value).toBe(positionFailure)
    scope.stop()
  })
})
