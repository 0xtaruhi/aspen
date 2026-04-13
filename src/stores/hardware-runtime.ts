import { isTauriUnavailable } from './hardware-runtime-errors'
import { start, stop } from './hardware-runtime-lifecycle'
import {
  dataStreamStatus,
  deviceTelemetry,
  hotplugLog,
  isStarted,
  runtimeState,
  signalTelemetry,
} from './hardware-runtime-state'
import { dispatch, refreshDataStreamStatus, syncState } from './hardware-runtime-sync'
import {
  configureDataStream,
  disconnectView,
  setDataStreamRate,
  startDataStream,
  stopDataStream,
} from './hardware-runtime-stream'

export { dispatch, refreshDataStreamStatus, syncState }
export { start, stop }
export { configureDataStream, disconnectView, setDataStreamRate, startDataStream, stopDataStream }
export { isTauriUnavailable }

export const hardwareRuntimeStore = {
  runtimeState,
  signalTelemetry,
  deviceTelemetry,
  dataStreamStatus,
  hotplugLog,
  isStarted,
  dispatch,
  syncState,
  start,
  stop,
  refreshDataStreamStatus,
  configureDataStream,
  setDataStreamRate,
  startDataStream,
  stopDataStream,
  disconnectView,
  isTauriUnavailable,
}
