import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

async function loadWorkbenchHarness() {
  vi.resetModules()

  const runtimeStarted = ref(false)
  const inputSignalOrder = ref<string[]>(['sig_in'])
  const outputSignalOrder = ref<string[]>(['sig_out'])
  const configureDataStream = vi.fn(async () => undefined)
  const start = vi.fn(async () => {
    runtimeStarted.value = true
  })
  const stop = vi.fn(async () => {
    runtimeStarted.value = false
  })

  vi.doMock('@/stores/hardware', () => ({
    hardwareStore: {
      isStarted: runtimeStarted,
      configureDataStream,
      start,
      stop,
    },
  }))

  vi.doMock('@/stores/signal-catalog', () => ({
    signalCatalogStore: {
      streamInputSignalOrder: inputSignalOrder,
      streamOutputSignalOrder: outputSignalOrder,
    },
  }))

  const { hardwareWorkbenchStore } = await import('./hardware-workbench')

  return {
    hardwareWorkbenchStore,
    runtimeStarted,
    inputSignalOrder,
    outputSignalOrder,
    configureDataStream,
    start,
    stop,
  }
}

describe('hardware workbench store', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('boots the global hardware runtime once and syncs the current signal map', async () => {
    const { hardwareWorkbenchStore, configureDataStream, start } = await loadWorkbenchHarness()

    await hardwareWorkbenchStore.boot()
    await nextTick()

    expect(start).toHaveBeenCalledTimes(1)
    expect(configureDataStream).toHaveBeenCalledTimes(1)
    expect(configureDataStream).toHaveBeenLastCalledWith(['sig_in'], ['sig_out'], {
      wordsPerCycle: 4,
      vericommClockHighDelay: 4,
      vericommClockLowDelay: 4,
    })
  })

  it('resyncs the stream map when pin-driven signal order changes outside the VDP page', async () => {
    const { hardwareWorkbenchStore, configureDataStream, inputSignalOrder, outputSignalOrder } =
      await loadWorkbenchHarness()

    await hardwareWorkbenchStore.boot()
    await nextTick()
    configureDataStream.mockClear()

    inputSignalOrder.value = ['sig_in', 'sig_jump']
    outputSignalOrder.value = ['sig_out', 'sig_led']
    await nextTick()

    expect(configureDataStream).toHaveBeenCalledTimes(1)
    expect(configureDataStream).toHaveBeenLastCalledWith(
      ['sig_in', 'sig_jump'],
      ['sig_out', 'sig_led'],
      {
        wordsPerCycle: 4,
        vericommClockHighDelay: 4,
        vericommClockLowDelay: 4,
      },
    )
  })
})
