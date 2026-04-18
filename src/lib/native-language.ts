import { invoke, isTauri } from '@tauri-apps/api/core'

export type NativeLanguage = 'en-US' | 'zh-CN' | 'zh-TW'

let lastSyncedLanguage: NativeLanguage | null = null
let desiredLanguage: NativeLanguage | null = null
let syncInFlight: Promise<void> | null = null

export async function syncNativeMenuLanguage(language: NativeLanguage) {
  if (!isTauri()) {
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
          await invoke('app_set_menu_language', { language: languageToSync })
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
