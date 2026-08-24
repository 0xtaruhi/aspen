import type { HardwareAccessConfigV1, HardwareBoardSelectorV1 } from '@/lib/hardware-client'

import { isTauri } from '@tauri-apps/api/core'

import { configureHardwareAccess } from '@/lib/hardware-client'
import { settingsStore } from '@/stores/settings'

export function hardwareBoardSelectorKey(selector: HardwareBoardSelectorV1) {
  switch (selector.kind) {
    case 'serial_number':
      return `serial:${selector.serial_number}`
    case 'usb_location':
      return `usb:${selector.bus_id}:${selector.port_chain.join('.')}`
    default:
      return 'only'
  }
}

export function currentHardwareAccessConfig(): HardwareAccessConfigV1 {
  return {
    selector: settingsStore.state.hardwareBoardSelector,
    customer_id: settingsStore.state.vlfdCustomerId,
  }
}

export async function syncHardwareAccess() {
  const config = currentHardwareAccessConfig()
  return isTauri() ? configureHardwareAccess(config) : config
}
