import { readonly, ref } from 'vue'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

export type ThemeMode = 'system' | 'light' | 'dark'

const systemThemeQuery = '(prefers-color-scheme: dark)'
const isDark = ref(false)

let initialized = false
let currentMode: ThemeMode = 'system'
let media: MediaQueryList | null = null
let mediaListener: ((event: MediaQueryListEvent) => void) | null = null
let nativeThemeListener: Promise<void> | null = null
let syncToken = 0

function commitTheme(mode: ThemeMode, resolvedDark: boolean) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.dataset.themeMode = mode
  document.documentElement.dataset.themeResolved = resolvedDark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = resolvedDark ? 'dark' : 'light'
  document.documentElement.classList.toggle('dark', resolvedDark)
  isDark.value = resolvedDark
}

function fixedModeDark(mode: ThemeMode) {
  if (mode === 'system') {
    return null
  }

  return mode === 'dark'
}

function browserSystemDark() {
  return media?.matches ?? false
}

async function desktopSystemDark(): Promise<boolean | null> {
  if (!isTauri()) {
    return null
  }

  try {
    return (await invoke<'light' | 'dark'>('app_get_system_theme')) === 'dark'
  } catch {
    const theme = await getCurrentWindow()
      .theme()
      .catch(() => null)
    return theme ? theme === 'dark' : null
  }
}

async function applyNativeTheme(mode: ThemeMode, resolvedDark: boolean): Promise<boolean | null> {
  if (!isTauri()) {
    return null
  }

  try {
    return await invoke<boolean>('app_set_window_appearance', { mode, resolvedDark })
  } catch (error) {
    console.error('Failed to sync native window appearance', error)
    return null
  }
}

async function ensureNativeThemeListener() {
  if (!isTauri()) {
    return
  }

  if (nativeThemeListener) {
    await nativeThemeListener
    return
  }

  nativeThemeListener = getCurrentWindow()
    .onThemeChanged(({ payload }) => {
      if (currentMode !== 'system') {
        return
      }

      const resolvedDark = payload === 'dark'
      commitTheme('system', resolvedDark)
      void applyNativeTheme('system', resolvedDark)
    })
    .then(() => undefined)
    .catch((error) => {
      nativeThemeListener = null
      console.error('Failed to install native theme listener', error)
    })

  await nativeThemeListener
}

async function resolveThemeDark(mode: ThemeMode) {
  const fixed = fixedModeDark(mode)
  return fixed ?? (await desktopSystemDark()) ?? browserSystemDark()
}

async function applyThemeMode(mode: ThemeMode) {
  const token = ++syncToken
  currentMode = mode

  if (mode === 'system') {
    await ensureNativeThemeListener()
  }

  const resolvedDark = await resolveThemeDark(mode)
  if (token !== syncToken || mode !== currentMode) {
    return
  }

  commitTheme(mode, resolvedDark)

  const nativeResolvedDark = await applyNativeTheme(mode, resolvedDark)
  if (nativeResolvedDark !== null && token === syncToken && mode === currentMode) {
    commitTheme(mode, nativeResolvedDark)
  }
}

export function initThemeSync(mode: ThemeMode = 'system') {
  if (initialized || typeof window === 'undefined') {
    return
  }

  initialized = true
  media = window.matchMedia(systemThemeQuery)
  void applyThemeMode(mode)

  mediaListener = (event: MediaQueryListEvent) => {
    if (currentMode !== 'system' || isTauri()) {
      return
    }

    commitTheme('system', event.matches)
  }

  if (typeof media.addEventListener === 'function') {
    media.addEventListener('change', mediaListener)
  } else if (typeof media.addListener === 'function') {
    media.addListener(mediaListener)
  }
}

export function setThemeMode(mode: ThemeMode) {
  if (typeof document === 'undefined') {
    return
  }

  if (!initialized) {
    initThemeSync(mode)
    return
  }

  void applyThemeMode(mode)
}

export function useThemeState() {
  return readonly(isDark)
}
