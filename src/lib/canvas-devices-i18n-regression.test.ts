import { beforeEach, describe, expect, it } from 'vitest'

import { createCanvasDeviceSnapshot, getCanvasDeviceTitle } from './canvas-devices'
import { settingsStore } from '@/stores/settings'

describe('canvas device i18n regression', () => {
  beforeEach(() => {
    settingsStore.setLanguage('zh-CN')
  })

  it('recomputes device titles from the current language instead of freezing module-load translations', () => {
    expect(getCanvasDeviceTitle('switch')).toBe('开关')

    settingsStore.setLanguage('en-US')

    expect(getCanvasDeviceTitle('switch')).toBe('Switch')
    expect(createCanvasDeviceSnapshot('switch', 'switch-1', 0, 0, 1).label).toBe('Switch 1')
  })
})
