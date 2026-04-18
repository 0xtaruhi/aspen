import * as tauriCore from '@tauri-apps/api/core'

export type NativeLanguage = 'en-US' | 'zh-CN' | 'zh-TW'

let lastSyncedLanguage: NativeLanguage | null = null
let desiredLanguage: NativeLanguage | null = null
let syncInFlight: Promise<void> | null = null

function canSyncNativeMenuLanguage() {
  try {
    return typeof tauriCore.invoke === 'function' && typeof tauriCore.isTauri === 'function'
  } catch {
    return false
  }
}

export async function syncNativeMenuLanguage(language: NativeLanguage) {
  if (!canSyncNativeMenuLanguage()) {
    return
  }

  try {
    if (!tauriCore.isTauri()) {
      return
    }
  } catch {
    return
  }

  desiredLanguage = language

  if (lastSyncedLanguage === language && syncInFlight === null) {
    return
  }

  if (syncInFlight === null) {
    syncInFlight = (async () => {
      while (desiredLanguage && desiredLanguage !== lastSyncedLanguage) {
        const languageToSync: NativeLanguage = desiredLanguage

        try {
          await tauriCore.invoke('app_set_menu_language', { language: languageToSync })
          if (desiredLanguage === languageToSync) {
            lastSyncedLanguage = languageToSync
          }
        } catch (error) {
          console.error('Failed to sync native menu language', error)
          break
        }
      }
    })()
  }

  const currentSync = syncInFlight

  try {
    await currentSync
  } finally {
    if (syncInFlight === currentSync) {
      syncInFlight = null
    }
  }
}
