import { reactive } from 'vue'

import { syncNativeMenuLanguage } from '@/lib/native-language'
import {
  applyThemeAccentColor,
  DEFAULT_THEME_ACCENT,
  normalizeThemeAccentColor,
} from '../lib/theme-accent'
import { setThemeMode, type ThemeMode } from '../lib/theme'

export type AppLanguage = 'en-US' | 'zh-CN' | 'zh-TW'

type SettingsState = {
  language: AppLanguage
  themeMode: ThemeMode
  themeAccent: string
  editorFontFamily: string
  editorFontSize: number
  editorMinimap: boolean
  confirmDelete: boolean
}

const STORAGE_KEY = 'aspen-settings'
export const DEFAULT_EDITOR_FONT_FAMILY =
  "'JetBrains Mono', 'Fira Code', 'SF Mono', Menlo, Consolas, monospace"

function normalizeLanguage(value: unknown): AppLanguage | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase().replace('_', '-')
  if (!normalized) {
    return null
  }

  if (
    normalized.startsWith('zh-hant') ||
    normalized.includes('-hant') ||
    normalized.endsWith('-tw') ||
    normalized.endsWith('-hk') ||
    normalized.endsWith('-mo')
  ) {
    return 'zh-TW'
  }

  if (normalized.startsWith('zh')) {
    return 'zh-CN'
  }

  if (normalized.startsWith('en')) {
    return 'en-US'
  }

  return null
}

function detectPreferredLanguage(): AppLanguage {
  if (typeof navigator === 'undefined') {
    return 'zh-CN'
  }

  const candidates = Array.isArray(navigator.languages) ? navigator.languages : []
  const orderedLanguages = candidates.length > 0 ? candidates : [navigator.language]

  for (const candidate of orderedLanguages) {
    const language = normalizeLanguage(candidate)
    if (language) {
      return language
    }
  }

  return 'en-US'
}

function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system'
}

function normalizeEditorFontFamily(value: unknown): string {
  if (typeof value !== 'string') {
    return DEFAULT_EDITOR_FONT_FAMILY
  }

  const normalized = value.trim()
  if (!normalized) {
    return DEFAULT_EDITOR_FONT_FAMILY
  }

  return normalized.slice(0, 200)
}

const defaultLanguage = detectPreferredLanguage()

const defaultSettings: SettingsState = {
  language: defaultLanguage,
  themeMode: 'system',
  themeAccent: DEFAULT_THEME_ACCENT,
  editorFontFamily: DEFAULT_EDITOR_FONT_FAMILY,
  editorFontSize: 14,
  editorMinimap: true,
  confirmDelete: true,
}

function applyLanguage(language: AppLanguage) {
  if (typeof document === 'undefined') {
    return
  }

  document.documentElement.lang =
    language === 'zh-CN' ? 'zh-Hans' : language === 'zh-TW' ? 'zh-Hant' : language
}

function readStoredSettings(): Partial<SettingsState> {
  if (typeof window === 'undefined') {
    return {}
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw) as Partial<SettingsState>
    if (!parsed || typeof parsed !== 'object') {
      return {}
    }

    return {
      ...parsed,
      language: normalizeLanguage(parsed.language) ?? defaultLanguage,
      themeMode: normalizeThemeMode(parsed.themeMode),
      themeAccent: normalizeThemeAccentColor(parsed.themeAccent),
      editorFontFamily: normalizeEditorFontFamily(parsed.editorFontFamily),
    }
  } catch (_) {
    return {}
  }
}

function writeStoredSettings(settings: SettingsState) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (_) {
    /* no-op */
  }
}

const state = reactive<SettingsState>({
  ...defaultSettings,
  ...readStoredSettings(),
})

applyLanguage(state.language)
setThemeMode(state.themeMode)
applyThemeAccentColor(state.themeAccent)
void syncNativeMenuLanguage(state.language)

export const settingsStore = {
  state,

  update(patch: Partial<SettingsState>) {
    const previousLanguage = state.language
    Object.assign(state, patch)
    state.themeMode = normalizeThemeMode(state.themeMode)
    state.themeAccent = normalizeThemeAccentColor(state.themeAccent)
    state.editorFontFamily = normalizeEditorFontFamily(state.editorFontFamily)
    applyLanguage(state.language)
    setThemeMode(state.themeMode)
    applyThemeAccentColor(state.themeAccent)
    writeStoredSettings(state)
    if (previousLanguage !== state.language) {
      void syncNativeMenuLanguage(state.language)
    }
  },

  setLanguage(language: AppLanguage) {
    this.update({ language })
  },

  setThemeMode(themeMode: ThemeMode) {
    this.update({ themeMode })
  },

  setThemeAccent(themeAccent: string) {
    this.update({ themeAccent })
  },

  setEditorFontFamily(editorFontFamily: string) {
    this.update({ editorFontFamily })
  },

  setEditorFontSize(editorFontSize: number) {
    this.update({ editorFontSize })
  },

  setEditorMinimap(editorMinimap: boolean) {
    this.update({ editorMinimap })
  },

  setConfirmDelete(confirmDelete: boolean) {
    this.update({ confirmDelete })
  },
}
