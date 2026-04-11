import type { UnlistenFn } from '@tauri-apps/api/event'

import { invoke, isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { reactive } from 'vue'

export type AppUpdateStatus =
  | 'idle'
  | 'unsupported'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'installing'
  | 'error'

interface AppUpdateCheckResult {
  currentVersion: string
  available: boolean
  version: string | null
  body: string | null
  date: string | null
}

interface AppUpdateCapability {
  currentVersion: string
  enabled: boolean
}

interface AppUpdateProgressPayload {
  phase: 'downloading' | 'installing' | 'restarting'
  downloadedBytes: number | null
  totalBytes: number | null
}

type UnsupportedReason = 'desktopOnly' | 'releaseOnly' | null

interface AppUpdateState {
  initialized: boolean
  supported: boolean
  currentVersion: string
  status: AppUpdateStatus
  latestVersion: string | null
  latestBody: string | null
  latestDate: string | null
  lastCheckedAt: number | null
  downloadedBytes: number
  totalBytes: number | null
  errorMessage: string | null
  unsupportedReason: UnsupportedReason
}

const UPDATE_PROGRESS_EVENT = 'aspen://app-update-progress'

const state = reactive<AppUpdateState>({
  initialized: false,
  supported: false,
  currentVersion: '-',
  status: 'idle',
  latestVersion: null,
  latestBody: null,
  latestDate: null,
  lastCheckedAt: null,
  downloadedBytes: 0,
  totalBytes: null,
  errorMessage: null,
  unsupportedReason: null,
})

let unlistenProgress: UnlistenFn | null = null
let initializePromise: Promise<void> | null = null
let autoCheckPromise: Promise<void> | null = null

function getErrorMessage(error: unknown) {
  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) {
      return message
    }
  }

  return 'Unknown updater error'
}

function resetUpdateCandidate() {
  state.latestVersion = null
  state.latestBody = null
  state.latestDate = null
  state.downloadedBytes = 0
  state.totalBytes = null
}

function handleProgress(payload: AppUpdateProgressPayload) {
  switch (payload.phase) {
    case 'downloading':
      state.status = 'installing'
      state.downloadedBytes = payload.downloadedBytes ?? state.downloadedBytes
      state.totalBytes = payload.totalBytes ?? state.totalBytes
      break
    case 'installing':
      state.status = 'installing'
      break
    case 'restarting':
      state.status = 'installing'
      break
  }
}

async function initialize() {
  if (state.initialized) {
    return
  }

  if (initializePromise) {
    await initializePromise
    return
  }

  initializePromise = (async () => {
    if (!isTauri()) {
      state.initialized = true
      state.supported = false
      state.status = 'unsupported'
      state.unsupportedReason = 'desktopOnly'
      return
    }

    const capability = await invoke<AppUpdateCapability>('app_get_update_capability')
    state.currentVersion = capability.currentVersion
    state.supported = capability.enabled
    state.unsupportedReason = capability.enabled ? null : 'releaseOnly'
    if (!capability.enabled) {
      state.initialized = true
      state.status = 'unsupported'
      return
    }

    unlistenProgress = await listen<AppUpdateProgressPayload>(UPDATE_PROGRESS_EVENT, (event) => {
      handleProgress(event.payload)
    })
    state.initialized = true
  })()

  try {
    await initializePromise
  } finally {
    initializePromise = null
  }
}

export const appUpdateStore = {
  state,

  async initialize() {
    try {
      await initialize()
    } catch (error) {
      state.initialized = true
      state.supported = false
      state.status = 'error'
      state.errorMessage = getErrorMessage(error)
    }
  },

  async checkForUpdates() {
    await this.initialize()
    if (!state.supported) {
      return
    }

    state.status = 'checking'
    state.errorMessage = null
    resetUpdateCandidate()

    try {
      const result = await invoke<AppUpdateCheckResult>('app_check_for_updates')
      state.currentVersion = result.currentVersion
      state.lastCheckedAt = Date.now()

      if (result.available) {
        state.status = 'available'
        state.latestVersion = result.version
        state.latestBody = result.body
        state.latestDate = result.date
        return
      }

      state.status = 'up-to-date'
    } catch (error) {
      state.status = 'error'
      state.errorMessage = getErrorMessage(error)
    }
  },

  async maybeAutoCheck() {
    await this.initialize()
    if (
      !state.supported ||
      state.lastCheckedAt !== null ||
      state.status === 'checking' ||
      state.status === 'installing'
    ) {
      return
    }

    if (autoCheckPromise) {
      await autoCheckPromise
      return
    }

    autoCheckPromise = this.checkForUpdates().finally(() => {
      autoCheckPromise = null
    })

    await autoCheckPromise
  },

  async installUpdate() {
    await this.initialize()
    if (!state.supported || !state.latestVersion) {
      return
    }

    state.status = 'installing'
    state.errorMessage = null
    state.downloadedBytes = 0
    state.totalBytes = null

    try {
      await invoke('app_install_update')
    } catch (error) {
      state.status = 'error'
      state.errorMessage = getErrorMessage(error)
    }
  },

  dispose() {
    unlistenProgress?.()
    unlistenProgress = null
  },
}
