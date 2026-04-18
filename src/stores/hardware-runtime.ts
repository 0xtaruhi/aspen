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
  setWaveformEnabled,
  startDataStream,
  stopDataStream,
} from './hardware-runtime-stream'
import {
  clearWaveformSamples,
  resetWaveformState,
  setWaveformTrackedSignals,
  waveformLastSequence,
  waveformRevision,
  waveformSampleRateHz,
  waveformTrackedSignals,
  waveformTracks,
} from './hardware-runtime-waveform'

export { dispatch, refreshDataStreamStatus, syncState }
export { start, stop }
export {
  configureDataStream,
  disconnectView,
  setDataStreamRate,
  setWaveformEnabled,
  startDataStream,
  stopDataStream,
}
export { clearWaveformSamples, resetWaveformState, setWaveformTrackedSignals }
export { isTauriUnavailable }

export const hardwareRuntimeStore = {
  runtimeState,
  signalTelemetry,
  deviceTelemetry,
  dataStreamStatus,
  waveformTrackedSignals,
  waveformTracks,
  waveformRevision,
  waveformSampleRateHz,
  waveformLastSequence,
  hotplugLog,
  isStarted,
  dispatch,
  syncState,
  start,
  stop,
  refreshDataStreamStatus,
  configureDataStream,
  setDataStreamRate,
  setWaveformEnabled,
  startDataStream,
  stopDataStream,
  disconnectView,
  setWaveformTrackedSignals,
  clearWaveformSamples,
  resetWaveformState,
  isTauriUnavailable,
}
