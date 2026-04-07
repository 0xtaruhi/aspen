type AsyncLifecycleHooks = {
  start: () => Promise<void>
  stop: () => Promise<void>
  isStarted: () => boolean
}

export function createAsyncViewLifecycle({ start, stop, isStarted }: AsyncLifecycleHooks) {
  let activeViewCount = 0
  let lifecycleQueue = Promise.resolve()

  function queue(task: () => Promise<void>) {
    const next = lifecycleQueue.then(task, task)
    lifecycleQueue = next.catch(() => undefined)
    return next
  }

  return {
    acquire() {
      activeViewCount += 1
      return queue(async () => {
        if (isStarted()) {
          return
        }

        await start()
      })
    },

    release() {
      activeViewCount = Math.max(0, activeViewCount - 1)
      return queue(async () => {
        if (activeViewCount > 0 || !isStarted()) {
          return
        }

        await stop()
      })
    },

    activeViewCount() {
      return activeViewCount
    },
  }
}
