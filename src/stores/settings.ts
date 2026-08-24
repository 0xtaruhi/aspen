import type { ThemeMode } from '@/lib/theme'
import type { HardwareBoardSelectorV1 } from '@/lib/hardware-client'

import { reactive } from 'vue'

import { syncNativeMenuLanguage } from '@/lib/native-language'
import { setThemeMode } from '@/lib/theme'
import {
  applyThemeAccentColor,
  DEFAULT_THEME_ACCENT,
  normalizeThemeAccentColor,
} from '@/lib/theme-accent'

export type AppLanguage = 'en-US' | 'zh-CN' | 'zh-TW'

type SettingsState = {
  language: AppLanguage
  themeMode: ThemeMode
  themeAccent: string
  editorFontFamily: string
  editorFontSize: number
  editorMinimap: boolean
  confirmDelete: boolean
  hardwareBoardSelector: HardwareBoardSelectorV1
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

function normalizeHardwareBoardSelector(value: unknown): HardwareBoardSelectorV1 {
  if (!value || typeof value !== 'object' || !('kind' in value)) {
    return { kind: 'only' }
  }

  const selector = value as Partial<HardwareBoardSelectorV1>
  if (selector.kind === 'serial_number' && 'serial_number' in selector) {
    const serialNumber = String(selector.serial_number ?? '').trim()
    return serialNumber ? { kind: 'serial_number', serial_number: serialNumber } : { kind: 'only' }
  }
  if (selector.kind === 'usb_location' && 'bus_id' in selector && 'port_chain' in selector) {
    const busId = String(selector.bus_id ?? '').trim()
    const portChain = Array.isArray(selector.port_chain)
      ? selector.port_chain.filter((part): part is number => Number.isInteger(part) && part >= 0)
      : []
    if (busId && portChain.length > 0) {
      return { kind: 'usb_location', bus_id: busId, port_chain: portChain }
    }
  }
  return { kind: 'only' }
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
  hardwareBoardSelector: { kind: 'only' },
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
      hardwareBoardSelector: normalizeHardwareBoardSelector(parsed.hardwareBoardSelector),
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
    state.hardwareBoardSelector = normalizeHardwareBoardSelector(state.hardwareBoardSelector)
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

  setHardwareBoardSelector(hardwareBoardSelector: HardwareBoardSelectorV1) {
    this.update({ hardwareBoardSelector })
  },
}
