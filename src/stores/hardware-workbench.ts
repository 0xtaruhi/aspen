import { computed, readonly, watch } from 'vue'

import { hardwareStore } from '@/stores/hardware'
import { signalCatalogStore } from '@/stores/signal-catalog'

export const HARDWARE_STREAM_WORDS_PER_CYCLE = 4
export const HARDWARE_STREAM_CLOCK_DELAY = 4

let bootPromise: Promise<void> | null = null
let stopStreamSignalMapWatcher: (() => void) | null = null

const streamInputSignalOrderKey = computed(() => {
  return signalCatalogStore.streamInputSignalOrder.value.join('\u0000')
})

const streamOutputSignalOrderKey = computed(() => {
  return signalCatalogStore.streamOutputSignalOrder.value.join('\u0000')
})

async function syncStreamSignalMap() {
  return hardwareStore.configureDataStream(
    signalCatalogStore.streamInputSignalOrder.value,
    signalCatalogStore.streamOutputSignalOrder.value,
    {
      wordsPerCycle: HARDWARE_STREAM_WORDS_PER_CYCLE,
      vericommClockHighDelay: HARDWARE_STREAM_CLOCK_DELAY,
      vericommClockLowDelay: HARDWARE_STREAM_CLOCK_DELAY,
    },
  )
}

function ensureStreamSignalMapWatcher() {
  if (stopStreamSignalMapWatcher) {
    return
  }

  stopStreamSignalMapWatcher = watch(
    [() => hardwareStore.isStarted.value, streamInputSignalOrderKey, streamOutputSignalOrderKey],
    ([isStarted]) => {
      if (!isStarted) {
        return
      }

      void syncStreamSignalMap().catch(() => undefined)
    },
    { immediate: true },
  )
}

async function boot() {
  if (bootPromise) {
    return bootPromise
  }

  ensureStreamSignalMapWatcher()
  bootPromise = hardwareStore
    .start()
    .then(() => undefined)
    .finally(() => {
      bootPromise = null
    })

  return bootPromise
}

async function shutdown() {
  if (stopStreamSignalMapWatcher) {
    stopStreamSignalMapWatcher()
    stopStreamSignalMapWatcher = null
  }

  await hardwareStore.stop()
}

export const hardwareWorkbenchStore = {
  boot,
  shutdown,
  syncStreamSignalMap,
  streamInputSignalOrderKey: readonly(streamInputSignalOrderKey),
  streamOutputSignalOrderKey: readonly(streamOutputSignalOrderKey),
}
