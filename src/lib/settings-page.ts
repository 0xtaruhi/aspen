import type { MessageKey } from '@/lib/i18n'
import type { AppThemePresetColor } from '@/lib/theme-accent'
import type { ThemeMode } from '@/lib/theme'

import { computed, onMounted, ref, watch } from 'vue'
import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Monitor, Moon, Sun } from 'lucide-vue-next'

import { UPDATE_RELEASES_URL } from '@/lib/app-update'
import { APP_THEME_PRESET_COLORS, normalizeThemeAccentColor } from '@/lib/theme-accent'
import { useI18n } from '@/lib/i18n'
import { appUpdateStore } from '@/stores/app-update'
import {
  DEFAULT_EDITOR_FONT_FAMILY,
  settingsStore,
  type AppLanguage,
  type AppLanguage as SettingsLanguage,
} from '@/stores/settings'

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string

interface UpdateStateLike {
  status: 'idle' | 'unsupported' | 'checking' | 'up-to-date' | 'available' | 'installing' | 'error'
  unsupportedReason: 'desktopOnly' | 'releaseOnly' | null
  latestVersion: string | null
  latestDate: string | null
  latestBody: string | null
  currentVersion: string
  lastCheckedAt: number | null
  downloadedBytes: number
  totalBytes: number | null
  errorMessage: string | null
  supported: boolean
}

export const CUSTOM_EDITOR_FONT_PRESET = '__custom__'

export const EDITOR_FONT_PRESETS: Array<{
  value: string
  label?: string
  labelKey?: 'editorFontDefault'
}> = [
  {
    value: DEFAULT_EDITOR_FONT_FAMILY,
    labelKey: 'editorFontDefault',
  },
  {
    value: "'JetBrains Mono', monospace",
    label: 'JetBrains Mono',
  },
  {
    value: "'Fira Code', monospace",
    label: 'Fira Code',
  },
  {
    value: "'IBM Plex Mono', monospace",
    label: 'IBM Plex Mono',
  },
  {
    value: "'Cascadia Code', monospace",
    label: 'Cascadia Code',
  },
  {
    value: "'SF Mono', Menlo, Monaco, monospace",
    label: 'SF Mono',
  },
  {
    value: 'Menlo, Monaco, monospace',
    label: 'Menlo',
  },
]

export function resolveUpdateStatusLabel(updateState: UpdateStateLike, t: Translate) {
  switch (updateState.status) {
    case 'unsupported':
      return updateState.unsupportedReason === 'releaseOnly'
        ? t('updateTaggedReleaseOnly')
        : t('updateDesktopOnly')
    case 'checking':
      return t('checkingForUpdates')
    case 'up-to-date':
      return t('updateStatusUpToDate')
    case 'available':
      return updateState.latestVersion
        ? t('updateStatusAvailable', { version: updateState.latestVersion })
        : t('updateReady')
    case 'installing':
      return t('installingUpdate')
    case 'error':
      return t('updateStatusError')
    case 'idle':
    default:
      return t('updateReadyToCheck')
  }
}

export function formatUpdateTimestamp(
  timestamp: number | null,
  language: AppLanguage,
  t: Translate,
) {
  if (!timestamp) {
    return t('neverChecked')
  }

  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(timestamp)
}

export function formatReleaseDate(latestDate: string | null, language: AppLanguage) {
  if (!latestDate) {
    return null
  }

  const parsed = Date.parse(latestDate)
  if (Number.isNaN(parsed)) {
    return latestDate
  }

  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}

export function resolveUpdateDownloadProgress(updateState: UpdateStateLike, t: Translate) {
  if (
    updateState.status !== 'installing' ||
    !updateState.totalBytes ||
    updateState.totalBytes <= 0
  ) {
    return null
  }

  const percent = Math.max(
    0,
    Math.min(100, Math.round((updateState.downloadedBytes / updateState.totalBytes) * 100)),
  )
  return t('updateDownloadProgress', { percent })
}

export function resolveEditorFontPresetValue(editorFontFamily: string) {
  return (
    EDITOR_FONT_PRESETS.find((preset) => preset.value === editorFontFamily)?.value ??
    CUSTOM_EDITOR_FONT_PRESET
  )
}

export function useSettingsPageState() {
  const { t } = useI18n()
  const settingsState = settingsStore.state
  const updateState = appUpdateStore.state
  const editorFontFamilyInput = ref(settingsState.editorFontFamily)

  const fontSizeValue = computed(() => String(settingsState.editorFontSize))
  const themeAccentInput = computed(() => normalizeThemeAccentColor(settingsState.themeAccent))
  const themePresetOptions = Object.keys(APP_THEME_PRESET_COLORS) as AppThemePresetColor[]
  const themeModeOptions = computed(() => [
    {
      value: 'system' as const,
      label: t('themeModeSystem'),
      icon: Monitor,
    },
    {
      value: 'light' as const,
      label: t('themeModeLight'),
      icon: Sun,
    },
    {
      value: 'dark' as const,
      label: t('themeModeDark'),
      icon: Moon,
    },
  ])
  const languageOptions = computed(() => [
    { value: 'zh-CN' as const, label: t('chinese') },
    { value: 'zh-TW' as const, label: t('traditionalChinese') },
    { value: 'en-US' as const, label: t('english') },
  ])
  const themeModeIndex = computed(() =>
    themeModeOptions.value.findIndex((option) => option.value === settingsState.themeMode),
  )
  const themeModeThumbStyle = computed(() => ({
    transform: `translateX(${Math.max(0, themeModeIndex.value) * 100}%)`,
  }))
  const editorFontPresetOptions = computed(() => {
    return EDITOR_FONT_PRESETS.map((preset) => ({
      value: preset.value,
      label: preset.labelKey ? t(preset.labelKey) : (preset.label ?? preset.value),
    }))
  })
  const editorFontPresetValue = computed(() => {
    return resolveEditorFontPresetValue(settingsState.editorFontFamily)
  })
  const updateStatusLabel = computed(() => resolveUpdateStatusLabel(updateState, t))
  const formattedLastChecked = computed(() => {
    return formatUpdateTimestamp(updateState.lastCheckedAt, settingsState.language, t)
  })
  const formattedReleaseDate = computed(() => {
    return formatReleaseDate(updateState.latestDate, settingsState.language)
  })
  const updateDownloadProgress = computed(() => {
    return resolveUpdateDownloadProgress(updateState, t)
  })
  const canCheckForUpdates = computed(() => {
    return (
      updateState.supported &&
      updateState.status !== 'checking' &&
      updateState.status !== 'installing'
    )
  })
  const canInstallUpdate = computed(() => {
    return (
      updateState.supported &&
      Boolean(updateState.latestVersion) &&
      updateState.status !== 'installing'
    )
  })

  function handleLanguageChange(value: unknown) {
    if (value === 'en-US' || value === 'zh-CN' || value === 'zh-TW') {
      settingsStore.setLanguage(value as SettingsLanguage)
    }
  }

  function handleFontSizeChange(value: unknown) {
    const nextValue = Number(value)
    if (!Number.isNaN(nextValue)) {
      settingsStore.setEditorFontSize(nextValue)
    }
  }

  function handleEditorFontPresetChange(value: unknown) {
    if (typeof value !== 'string' || value === CUSTOM_EDITOR_FONT_PRESET) {
      return
    }

    editorFontFamilyInput.value = value
    settingsStore.setEditorFontFamily(value)
  }

  function commitEditorFontFamily() {
    settingsStore.setEditorFontFamily(editorFontFamilyInput.value)
    editorFontFamilyInput.value = settingsStore.state.editorFontFamily
  }

  function applyThemeAccentPreset(color: AppThemePresetColor) {
    settingsStore.setThemeAccent(APP_THEME_PRESET_COLORS[color])
  }

  function handleThemeAccentInput(value: string) {
    settingsStore.setThemeAccent(value)
  }

  function handleThemeModeChange(value: ThemeMode) {
    settingsStore.setThemeMode(value)
  }

  function handleEditorMinimapChange(value: boolean) {
    settingsStore.setEditorMinimap(value)
  }

  function handleConfirmDeleteChange(value: boolean) {
    settingsStore.setConfirmDelete(value)
  }

  async function handleCheckForUpdates() {
    await appUpdateStore.checkForUpdates()
  }

  async function handleInstallUpdate() {
    await appUpdateStore.installUpdate()
  }

  async function handleOpenReleases() {
    if (isTauri()) {
      await openUrl(UPDATE_RELEASES_URL)
      return
    }

    if (typeof window !== 'undefined') {
      window.open(UPDATE_RELEASES_URL, '_blank', 'noopener,noreferrer')
    }
  }

  onMounted(() => {
    void appUpdateStore.initialize()
  })

  watch(
    () => settingsStore.state.editorFontFamily,
    (fontFamily) => {
      if (fontFamily !== editorFontFamilyInput.value) {
        editorFontFamilyInput.value = fontFamily
      }
    },
  )

  return {
    applyThemeAccentPreset,
    canCheckForUpdates,
    canInstallUpdate,
    commitEditorFontFamily,
    editorFontFamilyInput,
    editorFontPresetOptions,
    editorFontPresetValue,
    fontSizeValue,
    formattedLastChecked,
    formattedReleaseDate,
    handleCheckForUpdates,
    handleConfirmDeleteChange,
    handleEditorFontPresetChange,
    handleEditorMinimapChange,
    handleFontSizeChange,
    handleInstallUpdate,
    handleLanguageChange,
    handleOpenReleases,
    handleThemeAccentInput,
    handleThemeModeChange,
    languageOptions,
    settingsState,
    t,
    themeAccentInput,
    themeModeOptions,
    themeModeThumbStyle,
    themePresetOptions,
    updateDownloadProgress,
    updateState,
    updateStatusLabel,
  }
}
