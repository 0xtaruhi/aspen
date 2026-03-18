import { afterEach, describe, expect, it } from 'vitest'

import { translate } from './i18n'
import enUsMessages from '@/lib/locales/en-US.json'
import zhCnMessages from '@/lib/locales/zh-CN.json'
import zhTwMessages from '@/lib/locales/zh-TW.json'
import { settingsStore } from '@/stores/settings'

const originalLanguage = settingsStore.state.language

afterEach(() => {
  settingsStore.setLanguage(originalLanguage)
})

describe('i18n traditional chinese support', () => {
  it('keeps locale message keys aligned', () => {
    expect(Object.keys(zhCnMessages).sort()).toEqual(Object.keys(enUsMessages).sort())
    expect(Object.keys(zhTwMessages).sort()).toEqual(Object.keys(enUsMessages).sort())
  })

  it('renders derived traditional chinese strings', () => {
    settingsStore.setLanguage('zh-TW')

    expect(translate('implementation')).toBe('實作')
    expect(translate('pinPlanning')).toBe('腳位規劃')
    expect(translate('saveProject')).toBe('儲存專案')
    expect(translate('openRecent')).toBe('開啟最近專案')
    expect(translate('traditionalChinese')).toBe('繁體中文')
  })
})
