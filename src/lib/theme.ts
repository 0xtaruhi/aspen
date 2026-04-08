import { readonly, ref } from 'vue'

const prefersDarkQuery = '(prefers-color-scheme: dark)'

export type ThemeMode = 'system' | 'light' | 'dark'

const isDark = ref(false)
let initialized = false
let currentMode: ThemeMode = 'system'
let media: MediaQueryList | null = null
let mediaListener: ((event: MediaQueryListEvent) => void) | null = null

function applyDarkClass(isDarkMode: boolean) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.classList.toggle('dark', isDarkMode)
}

function resolveIsDark(mode: ThemeMode) {
  if (mode === 'dark') {
    return true
  }

  if (mode === 'light') {
    return false
  }

  return media?.matches ?? false
}

function syncTheme(mode: ThemeMode) {
  currentMode = mode
  const nextIsDark = resolveIsDark(mode)
  document.documentElement.dataset.themeMode = mode
  document.documentElement.dataset.themeResolved = nextIsDark ? 'dark' : 'light'
  document.documentElement.style.colorScheme = nextIsDark ? 'dark' : 'light'
  applyDarkClass(nextIsDark)
  isDark.value = nextIsDark
}

export function initThemeSync(mode: ThemeMode = 'system') {
  if (initialized || typeof window === 'undefined') {
    return
  }

  initialized = true
  media = window.matchMedia(prefersDarkQuery)
  syncTheme(mode)

  mediaListener = (event: MediaQueryListEvent) => {
    if (currentMode !== 'system') {
      return
    }

    document.documentElement.dataset.themeResolved = event.matches ? 'dark' : 'light'
    document.documentElement.style.colorScheme = event.matches ? 'dark' : 'light'
    applyDarkClass(event.matches)
    isDark.value = event.matches
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

  syncTheme(mode)
}

export function useThemeState() {
  return readonly(isDark)
}
