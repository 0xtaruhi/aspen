import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import type {
  CanvasDeviceSnapshot,
  HardwareActionV1,
  HardwareDataStreamStatusV1,
  HardwareStateV1,
} from '@/lib/hardware-client'

function createLedDevice(id: string, label: string): CanvasDeviceSnapshot {
  return {
    id,
    type: 'led',
    x: 40,
    y: 60,
    label,
    state: {
      is_on: false,
      color: '#ef4444',
      binding: {
        kind: 'single',
        signal: `${id}_signal`,
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

function createHardwareState(canvasDevices: CanvasDeviceSnapshot[]): HardwareStateV1 {
  return {
    version: 1,
    phase: 'device_ready',
    device: null,
    artifact: null,
    last_error: null,
    op_id: null,
    updated_at_ms: Date.now(),
    canvas_devices: canvasDevices,
  }
}

function createDataStreamStatus(): HardwareDataStreamStatusV1 {
  return {
    running: false,
    target_hz: 1,
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

describe('hardware canvas ownership regression', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('keeps project canvas authoritative across runtime sync, dispatch, and disconnect', async () => {
    const staleRuntimeCanvas = [createLedDevice('runtime-led', 'Runtime LED')]
    const syncState = vi.fn(async () => createHardwareState(staleRuntimeCanvas))
    const dispatch = vi.fn(async (_action: HardwareActionV1) =>
      createHardwareState(staleRuntimeCanvas),
    )
    const disconnectView = vi.fn(async () => undefined)
    const runtimeState = ref<Omit<HardwareStateV1, 'canvas_devices'>>({
      version: 1,
      phase: 'idle',
      device: null,
      artifact: null,
      last_error: null,
      op_id: null,
      updated_at_ms: 0,
    })

    vi.doMock('./hardware-runtime', () => ({
      configureDataStream: vi.fn(),
      dispatch,
      disconnectView,
      hardwareRuntimeStore: {
        runtimeState,
        signalTelemetry: ref({}),
        deviceTelemetry: ref({}),
        dataStreamStatus: ref(createDataStreamStatus()),
        hotplugLog: ref(''),
        isStarted: ref(false),
        isTauriUnavailable: vi.fn(() => false),
      },
      refreshDataStreamStatus: vi.fn(),
      setDataStreamRate: vi.fn(),
      startDataStream: vi.fn(),
      start: vi.fn(),
      stopDataStream: vi.fn(),
      stop: vi.fn(),
      syncState,
    }))

    vi.doMock('./hardware-flow', () => ({
      hardwareFlowStore: {
        synthesisRunning: ref(false),
        synthesisReport: ref(null),
        synthesisReportSignature: ref(null),
        synthesisLiveLog: ref(''),
        synthesisMessage: ref(''),
        implementationRunning: ref(false),
        implementationReport: ref(null),
        implementationReportSignature: ref(null),
        implementationLiveLog: ref(''),
        implementationMessage: ref(''),
        runSynthesis: vi.fn(),
        runImplementation: vi.fn(),
      },
    }))

    const { projectCanvasStore } = await import('./project-canvas')
    const { hardwareStore } = await import('./hardware')

    const projectLed = createLedDevice('project-led', 'Project LED')
    projectCanvasStore.setCanvasDevices([projectLed])

    await hardwareStore.syncState()

    expect(syncState).toHaveBeenCalledTimes(1)
    expect(hardwareStore.canvasDevices.value).toEqual([projectLed])
    expect(hardwareStore.state.value.canvas_devices).toEqual([projectLed])

    const renamedProjectLed = {
      ...projectLed,
      label: 'Renamed Project LED',
    }
    await hardwareStore.upsertCanvasDevice(renamedProjectLed)

    expect(dispatch).toHaveBeenCalledWith({
      type: 'upsert_canvas_device',
      device: renamedProjectLed,
    })
    expect(hardwareStore.canvasDevices.value).toEqual([renamedProjectLed])

    await hardwareStore.disconnectView()

    expect(disconnectView).toHaveBeenCalledTimes(1)
    expect(hardwareStore.canvasDevices.value).toEqual([renamedProjectLed])
  })

  it('persists upserted device settings when nested state still contains Vue proxies', async () => {
    const dispatch = vi.fn(async (_action: HardwareActionV1) => createHardwareState([]))
    const runtimeState = ref<Omit<HardwareStateV1, 'canvas_devices'>>({
      version: 1,
      phase: 'idle',
      device: null,
      artifact: null,
      last_error: null,
      op_id: null,
      updated_at_ms: 0,
    })

    vi.doMock('./hardware-runtime', () => ({
      configureDataStream: vi.fn(),
      dispatch,
      disconnectView: vi.fn(),
      hardwareRuntimeStore: {
        runtimeState,
        signalTelemetry: ref({}),
        deviceTelemetry: ref({}),
        dataStreamStatus: ref(createDataStreamStatus()),
        hotplugLog: ref(''),
        isStarted: ref(false),
        isTauriUnavailable: vi.fn(() => false),
      },
      refreshDataStreamStatus: vi.fn(),
      setDataStreamRate: vi.fn(),
      startDataStream: vi.fn(),
      start: vi.fn(),
      stopDataStream: vi.fn(),
      stop: vi.fn(),
      syncState: vi.fn(async () => createHardwareState([])),
    }))

    vi.doMock('./hardware-flow', () => ({
      hardwareFlowStore: {
        synthesisRunning: ref(false),
        synthesisReport: ref(null),
        synthesisReportSignature: ref(null),
        synthesisLiveLog: ref(''),
        synthesisMessage: ref(''),
        implementationRunning: ref(false),
        implementationReport: ref(null),
        implementationReportSignature: ref(null),
        implementationLiveLog: ref(''),
        implementationMessage: ref(''),
        runSynthesis: vi.fn(),
        runImplementation: vi.fn(),
      },
    }))

    const { projectCanvasStore } = await import('./project-canvas')
    const { hardwareStore } = await import('./hardware')

    const projectLed = createLedDevice('project-led', 'Project LED')
    projectCanvasStore.setCanvasDevices([projectLed])

    const proxiedDevice = hardwareStore.canvasDevices.value[0]
    const recoloredDevice = {
      ...proxiedDevice,
      state: {
        ...proxiedDevice.state,
        color: '#3b82f6',
      },
    }

    await expect(hardwareStore.upsertCanvasDevice(recoloredDevice)).resolves.toBeTruthy()
    expect(hardwareStore.canvasDevices.value[0]?.state.color).toBe('#3b82f6')
  })
})
