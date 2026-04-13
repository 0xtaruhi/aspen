import type { HardwareActionV1 } from '@/lib/hardware-client'

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function isTauriUnavailable(err: unknown): boolean {
  const message = getErrorMessage(err)
  return (
    message.includes('__TAURI_INTERNALS__') ||
    message.includes('window.__TAURI_INTERNALS__') ||
    /tauri.*plugin/i.test(message) ||
    message.includes("Cannot read properties of undefined (reading 'invoke')") ||
    message.includes("Cannot read properties of undefined (reading 'transformCallback')")
  )
}

export function isRuntimeOnlyAction(action: HardwareActionV1): boolean {
  return (
    action.type === 'probe' ||
    action.type === 'generate_bitstream' ||
    action.type === 'program_bitstream'
  )
}

export function runtimeUnavailableMessage(action: HardwareActionV1): string {
  switch (action.type) {
    case 'probe':
      return 'Hardware probing is unavailable in browser mode. Run the desktop app to connect to FPGA hardware.'
    case 'generate_bitstream':
      return 'Bitstream generation is unavailable in browser mode. Run the desktop app to build FPGA bitstreams.'
    case 'program_bitstream':
      return 'Bitstream programming is unavailable in browser mode. Run the desktop app to program FPGA hardware.'
    default:
      return 'Hardware runtime actions are unavailable in browser mode. Run the desktop app for hardware access.'
  }
}
