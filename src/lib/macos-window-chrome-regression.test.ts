import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const appSource = readFileSync(path.resolve(import.meta.dirname, '../App.vue'), 'utf8')
const indexSource = readFileSync(path.resolve(import.meta.dirname, '../index.css'), 'utf8')
const appearanceSource = readFileSync(
  path.resolve(import.meta.dirname, '../../src-tauri/src/app_appearance.rs'),
  'utf8',
)
const windowChromeSource = readFileSync(
  path.resolve(import.meta.dirname, '../directives/window-chrome.ts'),
  'utf8',
)

describe('macOS window chrome regression', () => {
  it('keeps the bordered workspace corner anchored directly to the live window bounds', () => {
    expect(appSource).toContain('.app-shell-root-native-frame .app-shell-workspace')
    expect(appSource).toMatch(
      /\.app-shell-root-native-frame \.app-shell-workspace\s*\{[^}]*border-radius:\s*var\(--radius-lg\);/s,
    )
    expect(appSource).toMatch(/\.app-shell-stage-native-frame\s*\{[^}]*position:\s*absolute;/s)
    expect(appSource).toMatch(
      /\.app-shell-stage-native-frame\s*\{[^}]*inset:\s*var\(--app-titlebar-height\) 0 0;/s,
    )
    expect(appSource).toMatch(
      /\.app-shell-stage-native-frame\s*\{[^}]*padding:\s*0\.2rem 0\.5rem 0\.5rem 0;/s,
    )
  })

  it('lets the native material follow window activation', () => {
    expect(appearanceSource).toContain('EffectState::FollowsWindowActiveState')
    expect(appearanceSource).not.toContain('.state(EffectState::Active)')
    expect(appearanceSource).not.toContain('NSScrollElasticity::None')
  })

  it('delegates titlebar double-click behavior to AppKit and the user preference', () => {
    expect(windowChromeSource).toContain("invoke('app_perform_titlebar_double_click')")
    expect(windowChromeSource).not.toContain("'toggleMaximize'")
    expect(appearanceSource).toContain('AppleActionOnDoubleClick')
    expect(appearanceSource).toContain('AppleMiniaturizeOnDoubleClick')
    expect(appearanceSource).toContain('ns_window.zoom(None)')
    expect(appearanceSource).toContain('ns_window.miniaturize(None)')
  })

  it('uses the system scrollbar policy for macOS scrollable content', () => {
    expect(indexSource).toContain(":root[data-platform-theme='macos'] .app-scrollbar-hidden")
    expect(indexSource).toMatch(
      /:root\[data-platform-theme='macos'\] \.app-scrollbar-hidden\s*\{[^}]*scrollbar-width:\s*auto;/s,
    )
  })
})
