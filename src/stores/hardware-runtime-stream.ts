import type { HardwareDataStreamConfigV1 } from '@/lib/hardware-client'

import {
  configureHardwareDataStream,
  setHardwareWaveformEnabled,
  setHardwareDataStreamRate,
  startHardwareDataStream,
  stopHardwareDataStream,
} from '@/lib/hardware-client'

import { isTauriUnavailable } from './hardware-runtime-errors'
import {
  applyDataStreamStatus,
  clearStoppedDataStreamTelemetry,
  configuredSignalOrder,
  resetRuntimeViewState,
} from './hardware-runtime-telemetry'
import {
  DATA_DEFAULT_CLOCK_HIGH_DELAY,
  DATA_DEFAULT_CLOCK_LOW_DELAY,
  DATA_DEFAULT_MAX_WAIT_US,
  DATA_DEFAULT_MIN_BATCH_CYCLES,
  dataStreamStatus,
  resetRuntimeState,
} from './hardware-runtime-state'
import {
  setWaveformSignalOrders,
  startWaveformPolling,
  stopWaveformPolling,
} from './hardware-runtime-waveform'

let waveformEnabled = false

function syncWaveformPolling() {
  if (waveformEnabled && dataStreamStatus.value.running) {
    startWaveformPolling()
    return
  }

  stopWaveformPolling()
}

export async function configureDataStream(
  inputSignalOrder: readonly string[],
  outputSignalOrder: readonly string[],
  options?: {
    wordsPerCycle?: number
    vericommClockHighDelay?: number
    vericommClockLowDelay?: number
  },
) {
  const wordsPerCycle = options?.wordsPerCycle ?? dataStreamStatus.value.words_per_cycle ?? 4
  const nextConfig: HardwareDataStreamConfigV1 = {
    target_hz: dataStreamStatus.value.target_hz || 1,
    input_signal_order: configuredSignalOrder(inputSignalOrder),
    output_signal_order: configuredSignalOrder(outputSignalOrder),
    waveform_enabled: waveformEnabled,
    words_per_cycle: Math.max(1, Math.floor(wordsPerCycle)),
    min_batch_cycles: dataStreamStatus.value.min_batch_cycles || DATA_DEFAULT_MIN_BATCH_CYCLES,
    max_wait_us: dataStreamStatus.value.max_wait_us || DATA_DEFAULT_MAX_WAIT_US,
    vericomm_clock_high_delay:
      options?.vericommClockHighDelay ??
      dataStreamStatus.value.vericomm_clock_high_delay ??
      DATA_DEFAULT_CLOCK_HIGH_DELAY,
    vericomm_clock_low_delay:
      options?.vericommClockLowDelay ??
      dataStreamStatus.value.vericomm_clock_low_delay ??
      DATA_DEFAULT_CLOCK_LOW_DELAY,
  }
  setWaveformSignalOrders(nextConfig.input_signal_order, nextConfig.output_signal_order)

  try {
    const status = await configureHardwareDataStream(nextConfig)
    applyDataStreamStatus(status)
    return status
  } catch (err) {
    if (isTauriUnavailable(err)) {
      applyDataStreamStatus({
        ...dataStreamStatus.value,
        target_hz: nextConfig.target_hz,
        words_per_cycle: nextConfig.words_per_cycle,
        min_batch_cycles: nextConfig.min_batch_cycles,
        max_wait_us: nextConfig.max_wait_us,
        vericomm_clock_high_delay: nextConfig.vericomm_clock_high_delay,
        vericomm_clock_low_delay: nextConfig.vericomm_clock_low_delay,
        configured_signal_count:
          nextConfig.input_signal_order.filter(Boolean).length +
          nextConfig.output_signal_order.filter(Boolean).length,
        last_error: null,
      })
      return dataStreamStatus.value
    }
    throw err
  }
}

export async function setWaveformEnabled(enabled: boolean) {
  waveformEnabled = enabled
  try {
    await setHardwareWaveformEnabled(enabled)
    syncWaveformPolling()
  } catch (err) {
    if (isTauriUnavailable(err)) {
      stopWaveformPolling()
      return
    }

    throw err
  }
}

export async function setDataStreamRate(rateHz: number) {
  try {
    const status = await setHardwareDataStreamRate(rateHz)
    applyDataStreamStatus(status)
    return status
  } catch (err) {
    if (isTauriUnavailable(err)) {
      applyDataStreamStatus({
        ...dataStreamStatus.value,
        target_hz: rateHz,
        last_error: null,
      })
      return dataStreamStatus.value
    }
    throw err
  }
}

export async function startDataStream() {
  try {
    await startHardwareDataStream()
    applyDataStreamStatus({
      ...dataStreamStatus.value,
      running: true,
      last_error: null,
    })
    syncWaveformPolling()
    return
  } catch (err) {
    if (isTauriUnavailable(err)) {
      applyDataStreamStatus({
        ...dataStreamStatus.value,
        running: true,
        last_error: null,
      })
      stopWaveformPolling()
      return
    }
    throw err
  }
}

export async function stopDataStream() {
  try {
    await stopHardwareDataStream()
  } catch (err) {
    if (!isTauriUnavailable(err)) {
      throw err
    }
  }

  clearStoppedDataStreamTelemetry()

  applyDataStreamStatus({
    ...dataStreamStatus.value,
    running: false,
    actual_hz: 0,
    transfer_rate_hz: 0,
    queue_fill: 0,
    last_batch_cycles: 0,
    last_error: null,
  })
  syncWaveformPolling()
}

export async function disconnectView() {
  if (dataStreamStatus.value.running) {
    await stopDataStream()
  }

  stopWaveformPolling()

  // Keep the global runtime and event listeners alive; this only clears the
  // current UI-facing session state so the user can reconnect/probe explicitly.
  resetRuntimeState()
  resetRuntimeViewState()
}
