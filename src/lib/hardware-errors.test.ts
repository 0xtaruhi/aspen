import { describe, expect, it } from 'vitest'

import { describeHardwareError } from './hardware-errors'
import { translate } from './i18n'
import { settingsStore } from '@/stores/settings'

describe('hardware error presentation', () => {
  it('maps raw USB device-not-found messages to a friendly localized message', () => {
    expect(describeHardwareError('device 0x2200:0x2008 not found')).toBe(
      translate('hardwareDeviceNotDetected'),
    )
  })

  it('maps device-disconnected state to a friendly reconnect message', () => {
    expect(describeHardwareError('Device disconnected', { phase: 'device_disconnected' })).toBe(
      translate('hardwareDeviceNotDetected'),
    )
  })

  it('preserves unrelated messages verbatim', () => {
    expect(describeHardwareError('No bitstream path provided')).toBe('No bitstream path provided')
  })

  it('follows the current UI language at render time', () => {
    const originalLanguage = settingsStore.state.language

    settingsStore.setLanguage('en-US')
    expect(describeHardwareError('device 0x2200:0x2008 not found')).toBe(
      translate('hardwareDeviceNotDetected'),
    )

    settingsStore.setLanguage('zh-CN')
    expect(describeHardwareError('device 0x2200:0x2008 not found')).toBe(
      translate('hardwareDeviceNotDetected'),
    )

    settingsStore.setLanguage(originalLanguage)
  })
})
