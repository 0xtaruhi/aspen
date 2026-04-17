import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

const platform =
  typeof navigator === 'undefined'
    ? ''
    : `${(navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? ''} ${navigator.platform} ${navigator.userAgent}`.toLowerCase()

export const isMacDesktop = isTauri() && platform.includes('mac')
export const showCustomWindowControls = isTauri() && !isMacDesktop

export function applyPlatformThemeClass() {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.dataset.platformTheme = isMacDesktop ? 'macos' : 'neutral'
}

export function runWindowAction(action: 'minimize' | 'toggleMaximize' | 'close') {
  if (!isTauri()) return
  const window = getCurrentWindow()
  const operation =
    action === 'minimize'
      ? window.minimize()
      : action === 'toggleMaximize'
        ? window.toggleMaximize()
        : window.close()
  void operation.catch(() => undefined)
}
