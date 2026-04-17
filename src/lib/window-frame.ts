import { isTauri } from '@tauri-apps/api/core'

const platform =
  typeof navigator === 'undefined'
    ? ''
    : `${(navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? ''} ${navigator.platform} ${navigator.userAgent}`.toLowerCase()

export const isMacDesktop = isTauri() && platform.includes('mac')

export function applyPlatformThemeClass() {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.dataset.platformTheme = isMacDesktop ? 'macos' : 'neutral'
}
