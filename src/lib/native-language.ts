import { invoke, isTauri } from '@tauri-apps/api/core'

export type NativeLanguage = 'en-US' | 'zh-CN' | 'zh-TW'

let lastSyncedLanguage: NativeLanguage | null = null

export async function syncNativeMenuLanguage(language: NativeLanguage) {
  if (!isTauri() || lastSyncedLanguage === language) {
    return
  }

  try {
    await invoke('app_set_menu_language', { language })
    lastSyncedLanguage = language
  } catch (error) {
    console.error('Failed to sync native menu language', error)
  }
}
