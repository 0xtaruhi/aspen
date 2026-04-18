import type { UnlistenFn } from '@tauri-apps/api/event'

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

import {
  listenHardwareDataBatchBinary,
  listenHardwareDataCatalog,
  listenHardwareDataStreamStatus,
  listenHardwareDeviceSnapshot,
  listenHardwareWaveformBatchBinary,
  listenHardwareStateChanged,
} from '@/lib/hardware-client'
import { translate } from '@/lib/i18n'

import { getErrorMessage, isTauriUnavailable } from './hardware-runtime-errors'
import {
  applyDataStreamStatus,
  onDataBatchBinary,
  onDataCatalog,
  onDeviceSnapshot,
  resetRuntimeViewState,
} from './hardware-runtime-telemetry'
import { onWaveformBatchBinary, resetWaveformState } from './hardware-runtime-waveform'
import { refreshDataStreamStatus, syncState } from './hardware-runtime-sync'
import {
  applyHardwareState,
  dataStreamStatus,
  hotplugLog,
  type HotplugPayload,
  isStarted,
  setError,
} from './hardware-runtime-state'
import { stopDataStream } from './hardware-runtime-stream'

let unlistenStateChanged: UnlistenFn | null = null
let unlistenHotplug: UnlistenFn | null = null
let unlistenDataBatch: UnlistenFn | null = null
let unlistenDataCatalog: UnlistenFn | null = null
let unlistenDeviceSnapshot: UnlistenFn | null = null
let unlistenDataStreamStatus: UnlistenFn | null = null
let unlistenWaveformBatch: UnlistenFn | null = null
let startPromise: Promise<void> | null = null

function clearRuntimeListeners() {
  if (unlistenStateChanged) {
    unlistenStateChanged()
    unlistenStateChanged = null
  }
  if (unlistenDataStreamStatus) {
    unlistenDataStreamStatus()
    unlistenDataStreamStatus = null
  }
  if (unlistenDataBatch) {
    unlistenDataBatch()
    unlistenDataBatch = null
  }
  if (unlistenDataCatalog) {
    unlistenDataCatalog()
    unlistenDataCatalog = null
  }
  if (unlistenDeviceSnapshot) {
    unlistenDeviceSnapshot()
    unlistenDeviceSnapshot = null
  }
  if (unlistenWaveformBatch) {
    unlistenWaveformBatch()
    unlistenWaveformBatch = null
  }
  if (unlistenHotplug) {
    unlistenHotplug()
    unlistenHotplug = null
  }
}

async function registerRuntimeListeners() {
  unlistenStateChanged = await listenHardwareStateChanged((event) => {
    applyHardwareState(event.state)
  })

  unlistenDataStreamStatus = await listenHardwareDataStreamStatus((status) => {
    applyDataStreamStatus(status)
  })

  unlistenDataCatalog = await listenHardwareDataCatalog((catalog) => {
    onDataCatalog(catalog)
  })

  unlistenDataBatch = await listenHardwareDataBatchBinary((batch) => {
    onDataBatchBinary(batch)
  })

  unlistenWaveformBatch = await listenHardwareWaveformBatchBinary((batch) => {
    onWaveformBatchBinary(batch)
  })

  unlistenDeviceSnapshot = await listenHardwareDeviceSnapshot((snapshot) => {
    onDeviceSnapshot(snapshot)
  })

  unlistenHotplug = await listen<HotplugPayload>('hardware:hotplug', (event) => {
    hotplugLog.value =
      event.payload.kind === 'arrived' ? translate('deviceConnected') : translate('deviceRemoved')
  })
}

export async function start() {
  if (isStarted.value) {
    return
  }

  if (startPromise) {
    await startPromise
    return
  }

  startPromise = (async () => {
    try {
      await syncState()
      await registerRuntimeListeners()

      try {
        await refreshDataStreamStatus()
      } catch (err) {
        if (!isTauriUnavailable(err)) {
          throw err
        }
      }

      await invoke('start_hotplug_watch')
      isStarted.value = true
    } catch (err) {
      clearRuntimeListeners()
      resetRuntimeViewState()
      resetWaveformState()
      if (isTauriUnavailable(err)) {
        isStarted.value = false
        return
      }
      setError(getErrorMessage(err))
      throw err
    } finally {
      startPromise = null
    }
  })()

  await startPromise
}

export async function stop() {
  if (!isStarted.value) {
    return
  }

  try {
    if (dataStreamStatus.value.running) {
      await stopDataStream()
    }
    await invoke('stop_hotplug_watch')
  } finally {
    clearRuntimeListeners()
    resetRuntimeViewState()
    resetWaveformState()
    isStarted.value = false
  }
}
