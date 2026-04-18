import {
  clearWaveformSamples as clearRuntimeWaveformSamples,
  configureDataStream as configureRuntimeDataStream,
  disconnectView as disconnectRuntimeView,
  refreshDataStreamStatus as refreshRuntimeDataStreamStatus,
  resetWaveformState as resetRuntimeWaveformState,
  setDataStreamRate as setRuntimeDataStreamRate,
  setWaveformEnabled as setRuntimeWaveformEnabled,
  setWaveformTrackedSignals as setRuntimeWaveformTrackedSignals,
  startDataStream as startRuntimeDataStream,
  start as startRuntime,
  stopDataStream as stopRuntimeDataStream,
  stop as stopRuntime,
} from './hardware-runtime'

export function createHardwareStoreRuntimeActions() {
  async function start() {
    return startRuntime()
  }

  async function stop() {
    return stopRuntime()
  }

  async function configureDataStream(
    inputSignalOrder: readonly string[],
    outputSignalOrder: readonly string[],
    options?: {
      wordsPerCycle?: number
      vericommClockHighDelay?: number
      vericommClockLowDelay?: number
    },
  ) {
    return configureRuntimeDataStream(inputSignalOrder, outputSignalOrder, options)
  }

  async function setDataStreamRate(rateHz: number) {
    return setRuntimeDataStreamRate(rateHz)
  }

  async function setWaveformEnabled(enabled: boolean) {
    return setRuntimeWaveformEnabled(enabled)
  }

  async function refreshDataStreamStatus() {
    return refreshRuntimeDataStreamStatus()
  }

  async function startDataStream() {
    return startRuntimeDataStream()
  }

  async function stopDataStream() {
    return stopRuntimeDataStream()
  }

  async function disconnectView() {
    await disconnectRuntimeView()
  }

  function setWaveformTrackedSignals(signals: readonly string[]) {
    setRuntimeWaveformTrackedSignals(signals)
  }

  function clearWaveformSamples() {
    clearRuntimeWaveformSamples()
  }

  function resetWaveformState() {
    resetRuntimeWaveformState()
  }

  return {
    start,
    stop,
    configureDataStream,
    setDataStreamRate,
    setWaveformEnabled,
    refreshDataStreamStatus,
    startDataStream,
    stopDataStream,
    disconnectView,
    setWaveformTrackedSignals,
    clearWaveformSamples,
    resetWaveformState,
  }
}
