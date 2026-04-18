import type {
  CanvasDeviceSnapshot,
  HardwareDataStreamStatusV1,
  HardwareStateV1,
} from '@/lib/hardware-client'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

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

function createDipSwitchDevice(signals: string[]): CanvasDeviceSnapshot {
  return {
    id: 'dip-1',
    type: 'dip_switch_bank',
    x: 20,
    y: 20,
    label: 'DIP',
    state: {
      is_on: false,
      color: null,
      binding: {
        kind: 'slots',
        signals,
      },
      config: {
        kind: 'dip_switch_bank',
        width: Math.max(1, signals.length),
      },
      data: {
        kind: 'bitset',
        bits: Array.from({ length: signals.length }, () => false),
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
    allSignals?: Array<{ name: string; direction: 'input' | 'output' | 'inout' }>
    canvasDevices?: CanvasDeviceSnapshot[]
    selectedDeviceIds?: string[]
    streamInputSignalOrder?: string[]
    streamOutputSignalOrder?: string[]
    keepScope?: boolean
    setWaveformEnabledImpl?: (enabled: boolean) => Promise<void>
  }) {
    const bindCanvasSignal = vi.fn(async () => undefined)
    const upsertCanvasDevice = vi.fn(async () => undefined)
    const setWaveformEnabled = vi.fn(options.setWaveformEnabledImpl ?? (async () => undefined))
    const canvasDevices = ref<CanvasDeviceSnapshot[]>(
      options.canvasDevices ?? [createLedDevice('io_led')],
    )

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
        setWaveformEnabled,
        setWaveformTrackedSignals: vi.fn(),
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

    const signalEntries = (
      options.allSignals ??
      options.workbenchSignals.map((name) => ({
        name,
        direction: 'output' as const,
      }))
    ).map(({ name, direction }) => ({
      name,
      bitName: name,
      assignedPin: null,
      assignedPinRole: null,
      boardFunction: null,
      bindingLabel: name,
      direction,
      width: '',
    }))

    vi.doMock('@/stores/signal-catalog', () => ({
      signalCatalogStore: {
        signals: ref(signalEntries),
        workbenchSignals: ref(
          signalEntries.filter((signal) => options.workbenchSignals.includes(signal.name)),
        ),
        hasSignalSourceReport: ref(options.hasSignalSourceReport),
        hasStaleSignalSourceReport: ref(options.hasStaleSignalSourceReport),
        streamInputSignalOrder: ref(options.streamInputSignalOrder ?? []),
        streamOutputSignalOrder: ref(options.streamOutputSignalOrder ?? []),
      },
    }))

    const { useVirtualDevicePlatformState } = await import('./use-virtual-device-platform-state')

    const scope = effectScope()
    const state = scope.run(() => useVirtualDevicePlatformState()) ?? null
    if (state && options.selectedDeviceIds) {
      state.selectedDeviceIds.value = [...options.selectedDeviceIds]
    }
    await Promise.resolve()
    await nextTick()

    const dispose = () => scope.stop()
    if (!options.keepScope) {
      dispose()
    }

    return {
      bindCanvasSignal,
      dispose,
      setWaveformEnabled,
      state,
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

  it('includes clock-like input signals in default waveform candidates', async () => {
    const { state } = await instantiateWithCatalog({
      hasSignalSourceReport: true,
      hasStaleSignalSourceReport: false,
      workbenchSignals: ['led'],
      allSignals: [
        { name: 'clk', direction: 'input' },
        { name: 'led', direction: 'output' },
      ],
      streamInputSignalOrder: ['clk'],
      streamOutputSignalOrder: ['led'],
    })

    expect(state?.waveformSignals.value).toEqual(['clk', 'led'])
  })

  it('keeps clock-like input signals visible when a single-signal device is selected', async () => {
    const selectedDevice = createLedDevice('led')
    const { state } = await instantiateWithCatalog({
      hasSignalSourceReport: true,
      hasStaleSignalSourceReport: false,
      workbenchSignals: ['led'],
      allSignals: [
        { name: 'clk', direction: 'input' },
        { name: 'led', direction: 'output' },
      ],
      canvasDevices: [selectedDevice],
      selectedDeviceIds: [selectedDevice.id],
      streamInputSignalOrder: ['clk'],
      streamOutputSignalOrder: ['led'],
    })

    expect(state?.waveformSignals.value).toEqual(['clk', 'led'])
  })

  it('keeps clock-like input signals in the waveform list when a device is selected', async () => {
    const selectedDevice = createDipSwitchDevice(['sig_a', 'sig_b'])
    const { state } = await instantiateWithCatalog({
      hasSignalSourceReport: true,
      hasStaleSignalSourceReport: false,
      workbenchSignals: ['sig_a', 'sig_b'],
      allSignals: [
        { name: 'clk', direction: 'input' },
        { name: 'sig_a', direction: 'output' },
        { name: 'sig_b', direction: 'output' },
      ],
      canvasDevices: [selectedDevice],
      selectedDeviceIds: [selectedDevice.id],
      streamInputSignalOrder: ['clk'],
      streamOutputSignalOrder: ['sig_a', 'sig_b'],
    })

    expect(state?.waveformSignals.value).toEqual(['clk', 'sig_a', 'sig_b'])
  })

  it('shows only clock-like input signals when the selected device has no bound ports', async () => {
    const selectedDevice = createLedDevice('')
    const { state } = await instantiateWithCatalog({
      hasSignalSourceReport: true,
      hasStaleSignalSourceReport: false,
      workbenchSignals: ['led'],
      allSignals: [
        { name: 'clk', direction: 'input' },
        { name: 'led', direction: 'output' },
      ],
      canvasDevices: [selectedDevice],
      selectedDeviceIds: [selectedDevice.id],
      streamInputSignalOrder: ['clk'],
      streamOutputSignalOrder: ['led'],
    })

    expect(state?.waveformSignals.value).toEqual(['clk'])
  })

  it('clears waveform toggle errors only after a later toggle succeeds', async () => {
    let enableCallCount = 0
    let resolvePendingToggle: () => void = () => undefined
    const pendingToggle = new Promise<void>((resolve) => {
      resolvePendingToggle = resolve
    })

    const { dispose, state } = await instantiateWithCatalog({
      hasSignalSourceReport: true,
      hasStaleSignalSourceReport: false,
      keepScope: true,
      workbenchSignals: ['led'],
      allSignals: [
        { name: 'clk', direction: 'input' },
        { name: 'led', direction: 'output' },
      ],
      streamInputSignalOrder: ['clk'],
      streamOutputSignalOrder: ['led'],
      setWaveformEnabledImpl: async () => {
        enableCallCount += 1

        if (enableCallCount === 2) {
          throw new Error('toggle failed')
        }

        if (enableCallCount === 3) {
          return pendingToggle
        }
      },
    })

    expect(state).not.toBeNull()

    state!.waveformPanelOpen.value = true
    await nextTick()
    await Promise.resolve()
    expect(state!.streamMessage.value).toBe('failedToToggleWaveformPanel')

    state!.waveformPanelOpen.value = false
    await nextTick()
    await Promise.resolve()
    expect(state!.streamMessage.value).toBe('failedToToggleWaveformPanel')

    resolvePendingToggle()
    await Promise.resolve()
    await nextTick()
    expect(state!.streamMessage.value).toBe('')

    dispose()
  })

  it('does not toggle waveform runtime again when only the visible signal set changes', async () => {
    const firstDevice = createLedDevice('sig_a')
    const secondDevice = createLedDevice('sig_b')
    const { dispose, setWaveformEnabled, state } = await instantiateWithCatalog({
      hasSignalSourceReport: true,
      hasStaleSignalSourceReport: false,
      keepScope: true,
      workbenchSignals: ['sig_a', 'sig_b'],
      allSignals: [
        { name: 'clk', direction: 'input' },
        { name: 'sig_a', direction: 'output' },
        { name: 'sig_b', direction: 'output' },
      ],
      canvasDevices: [firstDevice, secondDevice],
      selectedDeviceIds: [firstDevice.id],
      streamInputSignalOrder: ['clk'],
      streamOutputSignalOrder: ['sig_a', 'sig_b'],
    })

    expect(state).not.toBeNull()
    expect(setWaveformEnabled).toHaveBeenCalledTimes(1)

    state!.waveformPanelOpen.value = true
    await nextTick()
    await Promise.resolve()
    expect(setWaveformEnabled).toHaveBeenCalledTimes(2)

    state!.selectedDeviceIds.value = [secondDevice.id]
    await nextTick()
    await Promise.resolve()
    expect(setWaveformEnabled).toHaveBeenCalledTimes(2)

    dispose()
  })
})
