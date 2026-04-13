import { describe, expect, it } from 'vitest'
import type { MessageKey } from '@/lib/i18n'

import {
  formatReleaseDate,
  formatUpdateTimestamp,
  resolveEditorFontPresetValue,
  resolveUpdateDownloadProgress,
  resolveUpdateStatusLabel,
  CUSTOM_EDITOR_FONT_PRESET,
} from './settings-page'
import { DEFAULT_EDITOR_FONT_FAMILY } from '@/stores/settings'

const translations = {
  updateTaggedReleaseOnly: 'Tagged releases only',
  updateDesktopOnly: 'Desktop only',
  checkingForUpdates: 'Checking',
  updateStatusUpToDate: 'Up to date',
  updateStatusAvailable: 'Update {version}',
  updateReady: 'Ready',
  installingUpdate: 'Installing',
  updateStatusError: 'Error',
  updateReadyToCheck: 'Ready to check',
  neverChecked: 'Never checked',
  updateDownloadProgress: '{percent}% downloaded',
} as const

function t(key: MessageKey, params?: Record<string, string | number>) {
  const template = translations[key as keyof typeof translations] ?? key
  if (!params) {
    return template
  }
  return template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))
}

describe('settings page helpers', () => {
  it('maps update states to the correct user-facing labels', () => {
    expect(
      resolveUpdateStatusLabel(
        {
          status: 'unsupported',
          unsupportedReason: 'releaseOnly',
          latestVersion: null,
          latestDate: null,
          latestBody: null,
          currentVersion: '0.1.0',
          lastCheckedAt: null,
          downloadedBytes: 0,
          totalBytes: null,
          errorMessage: null,
          supported: false,
        },
        t,
      ),
    ).toBe('Tagged releases only')

    expect(
      resolveUpdateStatusLabel(
        {
          status: 'available',
          unsupportedReason: null,
          latestVersion: '0.2.0',
          latestDate: null,
          latestBody: null,
          currentVersion: '0.1.0',
          lastCheckedAt: null,
          downloadedBytes: 0,
          totalBytes: null,
          errorMessage: null,
          supported: true,
        },
        t,
      ),
    ).toBe('Update 0.2.0')
  })

  it('formats update timestamps and release dates with safe fallbacks', () => {
    expect(formatUpdateTimestamp(null, 'en-US', t)).toBe('Never checked')
    expect(formatReleaseDate(null, 'en-US')).toBeNull()
    expect(formatReleaseDate('not-a-date', 'en-US')).toBe('not-a-date')
  })

  it('reports download progress only while installing with known totals', () => {
    expect(
      resolveUpdateDownloadProgress(
        {
          status: 'installing',
          unsupportedReason: null,
          latestVersion: '0.2.0',
          latestDate: null,
          latestBody: null,
          currentVersion: '0.1.0',
          lastCheckedAt: null,
          downloadedBytes: 25,
          totalBytes: 100,
          errorMessage: null,
          supported: true,
        },
        t,
      ),
    ).toBe('25% downloaded')
  })

  it('detects whether the current editor font matches a preset', () => {
    expect(resolveEditorFontPresetValue(DEFAULT_EDITOR_FONT_FAMILY)).toBe(
      DEFAULT_EDITOR_FONT_FAMILY,
    )
    expect(resolveEditorFontPresetValue('Custom Mono')).toBe(CUSTOM_EDITOR_FONT_PRESET)
  })
})
