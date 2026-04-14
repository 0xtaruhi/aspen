import { describe, expect, it, vi, beforeEach } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import type {
  CanvasDeviceSnapshot,
  HardwareDataStreamStatusV1,
  HardwareStateV1,
} from '@/lib/hardware-client'

function createDataStreamStatus(): HardwareDataStreamStatusV1 {
  return {
    running: false,
    target_hz: 1000,
    actual_hz: 0,
    transfer_rate_hz: 0,
    sequence: 0,
    dropped_samples: 0,
    queue_fill: 0,
    queue_capacity: 0,
    last_batch_at_ms: 0,
    last_batch_cycles: 0,
    words_per_cycle: 4,
    min_batch_cycles: 128,
    max_wait_us: 2000,
    vericomm_clock_high_delay: 4,
    vericomm_clock_low_delay: 4,
    configured_signal_count: 0,
    last_error: null,
  }
}

function createHardwareState(): HardwareStateV1 {
  return {
    version: 1,
    phase: 'device_ready',
    device: {
      board: 'FDP3P7',
      description: 'Test Board',
      config: {
        smims_version: 'test',
        fifo_words: 1024,
        flash_total_block: 0,
        flash_block_size: 0,
        flash_cluster_size: 0,
        vericomm_enabled: true,
        programmed: true,
        pcb_connected: true,
      },
    },
    artifact: null,
    canvas_devices: [],
    last_error: null,
    op_id: null,
    updated_at_ms: 0,
  }
}

function createLedDevice(signal: string): CanvasDeviceSnapshot {
  return {
    id: 'led-1',
    type: 'led',
    x: 10,
    y: 10,
    label: 'LED',
    state: {
      is_on: false,
      color: '#ef4444',
      binding: {
        kind: 'single',
        signal,
      },
      config: {
        kind: 'none',
      },
      data: {
        kind: 'none',
      },
    },
  }
}

describe('virtual device platform binding sanitation', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  async function instantiateWithCatalog(options: {
    hasSignalSourceReport: boolean
    hasStaleSignalSourceReport: boolean
    workbenchSignals: string[]
  }) {
    const bindCanvasSignal = vi.fn(async () => undefined)
    const upsertCanvasDevice = vi.fn(async () => undefined)
    const canvasDevices = ref<CanvasDeviceSnapshot[]>([createLedDevice('io_led')])

    vi.doMock('@/lib/canvas-devices', async () => {
      const actual =
        await vi.importActual<typeof import('@/lib/canvas-devices')>('@/lib/canvas-devices')

      return {
        ...actual,
        getCanvasDeviceBoundSignal: vi.fn((device: CanvasDeviceSnapshot) => {
          return device.state.binding.kind === 'single'
            ? (device.state.binding.signal ?? null)
            : null
        }),
        getCanvasDeviceBoundSignals: vi.fn((device: CanvasDeviceSnapshot) => {
          return device.state.binding.kind === 'slots' ? [...device.state.binding.signals] : []
        }),
      }
    })

    vi.doMock('@/lib/confirm-action', () => ({
      confirmAction: vi.fn(async () => true),
    }))

    vi.doMock('@/lib/i18n', () => ({
      useI18n: () => ({
        t: (key: string) => key,
      }),
    }))

    vi.doMock('@/stores/design-context', () => ({
      designContextStore: {
        selectedSource: ref({ id: 'top', name: 'Top.v' }),
      },
    }))

    vi.doMock('@/stores/hardware', () => ({
      hardwareStore: {
        canvasDevices,
        dataStreamStatus: ref(createDataStreamStatus()),
        state: ref(createHardwareState()),
        bindCanvasSignal,
        upsertCanvasDevice,
        setDataStreamRate: vi.fn(async () => undefined),
        startDataStream: vi.fn(async () => undefined),
        stopDataStream: vi.fn(async () => undefined),
        clearCanvasDevices: vi.fn(async () => undefined),
        removeCanvasDevice: vi.fn(async () => undefined),
      },
    }))

    vi.doMock('@/stores/hardware-workbench', () => ({
      HARDWARE_STREAM_CLOCK_DELAY: 4,
      hardwareWorkbenchStore: {
        syncStreamSignalMap: vi.fn(async () => undefined),
      },
    }))

    vi.doMock('@/stores/project', () => ({
      projectStore: {
        sessionId: 1,
      },
    }))

    vi.doMock('@/stores/settings', () => ({
      settingsStore: {
        state: {
          confirmDelete: false,
        },
      },
    }))

    vi.doMock('@/stores/signal-catalog', () => ({
      signalCatalogStore: {
        workbenchSignals: ref(
          options.workbenchSignals.map((name) => ({
            name,
            bitName: name,
            assignedPin: null,
            assignedPinRole: null,
            boardFunction: null,
            bindingLabel: name,
            direction: 'output',
            width: '',
          })),
        ),
        hasSignalSourceReport: ref(options.hasSignalSourceReport),
        hasStaleSignalSourceReport: ref(options.hasStaleSignalSourceReport),
      },
    }))

    const { useVirtualDevicePlatformState } = await import('./use-virtual-device-platform-state')

    const scope = effectScope()
    scope.run(() => {
      useVirtualDevicePlatformState()
    })
    await Promise.resolve()
    await nextTick()
    scope.stop()

    return {
      bindCanvasSignal,
      upsertCanvasDevice,
    }
  }

  it('does not clear bindings before any successful synthesis signal report exists', async () => {
    const { bindCanvasSignal, upsertCanvasDevice } = await instantiateWithCatalog({
      hasSignalSourceReport: false,
      hasStaleSignalSourceReport: false,
      workbenchSignals: [],
    })

    expect(bindCanvasSignal).not.toHaveBeenCalled()
    expect(upsertCanvasDevice).not.toHaveBeenCalled()
  })

  it('does not clear bindings while the available signal report is stale', async () => {
    const { bindCanvasSignal, upsertCanvasDevice } = await instantiateWithCatalog({
      hasSignalSourceReport: true,
      hasStaleSignalSourceReport: true,
      workbenchSignals: [],
    })

    expect(bindCanvasSignal).not.toHaveBeenCalled()
    expect(upsertCanvasDevice).not.toHaveBeenCalled()
  })
})
