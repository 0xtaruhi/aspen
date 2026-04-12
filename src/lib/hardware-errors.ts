import type { HardwarePhase } from '@/lib/hardware-client'
import { translate } from '@/lib/i18n'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isDeviceNotDetectedMessage(message: string) {
  const lowered = message.toLowerCase()
  return (
    /device\s+0x[0-9a-f]+:0x[0-9a-f]+\s+not found/i.test(message) ||
    lowered.includes('no connected hardware device found') ||
    lowered.includes('no device') ||
    lowered.includes('not connected')
  )
}

function isDeviceDisconnectedMessage(message: string) {
  const lowered = message.toLowerCase()
  return lowered === 'device disconnected' || lowered.includes('device disconnected')
}

export function describeHardwareError(
  error: unknown,
  options: { phase?: HardwarePhase | null } = {},
) {
  const message = getErrorMessage(error)

  if (options.phase === 'device_disconnected') {
    return translate('hardwareDeviceNotDetected')
  }

  if (isDeviceNotDetectedMessage(message)) {
    return translate('hardwareDeviceNotDetected')
  }

  if (isDeviceDisconnectedMessage(message)) {
    return translate('hardwareDeviceDisconnectedError')
  }

  return message
}
