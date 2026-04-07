import { describe, expect, it, vi } from 'vitest'

import { createAsyncViewLifecycle } from './async-view-lifecycle'

describe('async view lifecycle', () => {
  it('starts once for the first attached view and stops after the last one releases', async () => {
    let started = false
    const start = vi.fn(async () => {
      started = true
    })
    const stop = vi.fn(async () => {
      started = false
    })
    const lifecycle = createAsyncViewLifecycle({
      start,
      stop,
      isStarted: () => started,
    })

    await lifecycle.acquire()
    await lifecycle.acquire()
    await lifecycle.release()

    expect(start).toHaveBeenCalledTimes(1)
    expect(stop).not.toHaveBeenCalled()
    expect(lifecycle.activeViewCount()).toBe(1)

    await lifecycle.release()

    expect(stop).toHaveBeenCalledTimes(1)
    expect(lifecycle.activeViewCount()).toBe(0)
  })

  it('prevents a direct page handoff from tearing the runtime down mid-transition', async () => {
    let started = false
    const events: string[] = []
    const start = vi.fn(async () => {
      events.push('start')
      started = true
    })
    const stop = vi.fn(async () => {
      events.push('stop')
      started = false
    })
    const lifecycle = createAsyncViewLifecycle({
      start,
      stop,
      isStarted: () => started,
    })

    await lifecycle.acquire()

    const releasePromise = lifecycle.release()
    const acquirePromise = lifecycle.acquire()

    await Promise.all([releasePromise, acquirePromise])

    expect(events).toEqual(['start'])
    expect(started).toBe(true)
    expect(lifecycle.activeViewCount()).toBe(1)
  })
})
