import {
  configureDataStream as configureRuntimeDataStream,
  disconnectView as disconnectRuntimeView,
  refreshDataStreamStatus as refreshRuntimeDataStreamStatus,
  setDataStreamRate as setRuntimeDataStreamRate,
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

  return {
    start,
    stop,
    configureDataStream,
    setDataStreamRate,
    refreshDataStreamStatus,
    startDataStream,
    stopDataStream,
    disconnectView,
  }
}
