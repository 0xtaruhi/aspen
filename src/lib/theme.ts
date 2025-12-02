import { readonly, ref } from "vue"

const prefersDarkQuery = "(prefers-color-scheme: dark)"
const STORAGE_KEY = "theme-preference"

type ThemePreference = "light" | "dark" | null

const isDark = ref(false)
let initialized = false
let manualPreference: ThemePreference = null
let media: MediaQueryList | null = null
let mediaListener: ((event: MediaQueryListEvent) => void) | null = null

function applyDarkClass(isDarkMode: boolean) {
    if (typeof document === "undefined") {
        return
    }

    document.documentElement.classList.toggle("dark", isDarkMode)
}

function readStoredPreference(): ThemePreference {
    if (typeof window === "undefined") {
        return null
    }

    try {
        const stored = window.localStorage.getItem(STORAGE_KEY)
        if (stored === "dark" || stored === "light") {
            return stored
        }
    } catch (_) {
        /* no-op */
    }

    return null
}

function writeStoredPreference(preference: Exclude<ThemePreference, null>) {
    if (typeof window === "undefined") {
        return
    }

    try {
        window.localStorage.setItem(STORAGE_KEY, preference)
    } catch (_) {
        /* no-op */
    }
}

function setThemeInternal(isDarkMode: boolean, options: { persist?: boolean } = {}) {
    applyDarkClass(isDarkMode)
    isDark.value = isDarkMode

    if (options.persist) {
        manualPreference = isDarkMode ? "dark" : "light"
        writeStoredPreference(manualPreference)
    }
}

export function initThemeSync() {
    if (initialized || typeof window === "undefined") {
        return
    }

    initialized = true
    media = window.matchMedia(prefersDarkQuery)

    manualPreference = readStoredPreference()

    if (manualPreference) {
        setThemeInternal(manualPreference === "dark")
    } else {
        setThemeInternal(media.matches)
    }

    mediaListener = (event: MediaQueryListEvent) => {
        if (manualPreference !== null) {
            return
        }

        setThemeInternal(event.matches)
    }

    if (typeof media.addEventListener === "function") {
        media.addEventListener("change", mediaListener)
    } else if (typeof media.addListener === "function") {
        media.addListener(mediaListener)
    }
}

export function toggleTheme() {
    setThemeInternal(!isDark.value, { persist: true })
}

export function useThemeState() {
    return readonly(isDark)
}
