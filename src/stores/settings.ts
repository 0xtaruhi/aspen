import { reactive } from 'vue'

import {
  applyThemeAccentColor,
  DEFAULT_THEME_ACCENT,
  normalizeThemeAccentColor,
} from '../lib/theme-accent'

export type AppLanguage = 'en-US' | 'zh-CN' | 'zh-TW'

type SettingsState = {
  language: AppLanguage
  themeAccent: string
  editorFontSize: number
  editorMinimap: boolean
  confirmDelete: boolean
}

const STORAGE_KEY = 'aspen-settings'

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

const defaultLanguage = detectPreferredLanguage()

const defaultSettings: SettingsState = {
  language: defaultLanguage,
  themeAccent: DEFAULT_THEME_ACCENT,
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
      themeAccent: normalizeThemeAccentColor(parsed.themeAccent),
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
applyThemeAccentColor(state.themeAccent)

export const settingsStore = {
  state,

  update(patch: Partial<SettingsState>) {
    Object.assign(state, patch)
    state.themeAccent = normalizeThemeAccentColor(state.themeAccent)
    applyLanguage(state.language)
    applyThemeAccentColor(state.themeAccent)
    writeStoredSettings(state)
  },

  setLanguage(language: AppLanguage) {
    this.update({ language })
  },

  setThemeAccent(themeAccent: string) {
    this.update({ themeAccent })
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
