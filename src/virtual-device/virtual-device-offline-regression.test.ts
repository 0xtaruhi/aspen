import { describe, expect, it, vi } from 'vitest'

const tauriUnavailableError = new Error(
  "Cannot read properties of undefined (reading '__TAURI_INTERNALS__')",
)

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(tauriUnavailableError),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockRejectedValue(tauriUnavailableError),
}))

vi.mock('@/lib/hardware-client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/hardware-client')>('@/lib/hardware-client')

  return {
    ...actual,
    hardwareDispatch: vi.fn().mockRejectedValue(tauriUnavailableError),
    hardwareGetDataStreamStatus: vi.fn().mockRejectedValue(tauriUnavailableError),
    hardwareGetState: vi.fn().mockRejectedValue(tauriUnavailableError),
    listenHardwareDataBatchBinary: vi.fn().mockRejectedValue(tauriUnavailableError),
    listenHardwareDataCatalog: vi.fn().mockRejectedValue(tauriUnavailableError),
    listenHardwareStateChanged: vi.fn().mockRejectedValue(tauriUnavailableError),
    startHardwareDataStream: vi.fn().mockRejectedValue(tauriUnavailableError),
    stopHardwareDataStream: vi.fn().mockResolvedValue(undefined),
  }
})

vi.mock('@/lib/canvas-devices', () => ({
  createCanvasDeviceSnapshot: vi.fn(
    (type: string, id: string, x: number, y: number, index: number) => ({
      id,
      type,
      x,
      y,
      label: `${type}-${index}`,
      state: {
        bound_signal: null,
        color: type === 'led' ? 'red' : null,
        is_on: false,
      },
    }),
  ),
  deviceDrivesSignal: vi.fn((type: string) => type === 'switch' || type === 'button'),
  deviceReceivesSignal: vi.fn((type: string) => type === 'led'),
}))

function createTestDevice(type: 'switch' | 'led', id: string, x: number, y: number, index: number) {
  return {
    id,
    type,
    x,
    y,
    label: `${type}-${index}`,
    state: {
      bound_signal: null,
      color: type === 'led' ? 'red' : null,
      is_on: false,
    },
  }
}

describe('virtual-device offline usability regression', () => {
  it('executes virtual-device store actions without requiring Tauri internals', async () => {
    const { hardwareStore } = await import('../stores/hardware')

    await expect(
      hardwareStore.start(),
      'Offline regression: hardwareStore.start() should gracefully no-op when Tauri internals are unavailable',
    ).resolves.toBeUndefined()

    const switchDevice = createTestDevice('switch', 'switch-offline', 10, 20, 1)
    const ledDevice = createTestDevice('led', 'led-offline', 30, 20, 2)

    await expect(
      hardwareStore.upsertCanvasDevice(switchDevice),
      'Offline regression: upsertCanvasDevice should not throw when Tauri runtime is unavailable',
    ).resolves.toBeTruthy()

    await expect(
      hardwareStore.upsertCanvasDevice(ledDevice),
      'Offline regression: virtual canvas edits must continue working in browser mode',
    ).resolves.toBeTruthy()

    await expect(
      hardwareStore.bindCanvasSignal('switch-offline', 'sig_clk'),
      'Offline regression: binding virtual signals must not require desktop runtime',
    ).resolves.toBeTruthy()

    await expect(
      hardwareStore.bindCanvasSignal('led-offline', 'sig_clk'),
      'Offline regression: signal wiring must remain usable without Tauri',
    ).resolves.toBeTruthy()

    await expect(
      hardwareStore.setCanvasSwitchState('switch-offline', true),
      'Offline regression: toggling virtual switches must not throw Tauri internals errors',
    ).resolves.toBeTruthy()

    const ledState = hardwareStore.state.value.canvas_devices.find(
      (device) => device.id === 'led-offline',
    )?.state.is_on

    expect(
      ledState,
      'Offline regression: virtual signal propagation failed; LED should mirror switch state in browser mode',
    ).toBe(true)

    await hardwareStore.disconnectView()
  })
})
