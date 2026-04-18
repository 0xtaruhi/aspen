import type { Ref } from 'vue'

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import { HARDWARE_STREAM_CLOCK_DELAY, hardwareWorkbenchStore } from '@/stores/hardware-workbench'

import { getErrorMessage } from './error-helpers'
import {
  computeStreamScheduleLagMs,
  formatActualHz,
  formatRate,
  median,
  shouldWarnStreamBacklog,
} from './stream-helpers'

const DISPLAY_ACTUAL_HZ_INTERVAL_MS = 250
const DISPLAY_ACTUAL_HZ_SAMPLE_WINDOW = 5
const DISPLAY_ACTUAL_HZ_CONFIRMATION_SAMPLES = 3

type UseVirtualDevicePlatformStreamOptions = {
  streamBusy: Ref<boolean>
  streamMessage: Ref<string>
}

export function useVirtualDevicePlatformStream({
  streamBusy,
  streamMessage,
}: UseVirtualDevicePlatformStreamOptions) {
  const { t } = useI18n()
  const rateInput = ref<string | number>('1000')
  const displayActualHz = ref(0)
  const displayActualHzSamples: number[] = []
  let displayActualHzPendingSamples = 0
  let displayActualHzTimer: ReturnType<typeof setInterval> | null = null

  const streamStatus = computed(() => hardwareStore.dataStreamStatus.value)
  const streamRunning = computed(() => streamStatus.value.running)
  const isHardwareConnected = computed(() => {
    return Boolean(hardwareStore.state.value.device?.config.pcb_connected)
  })
  const canApplySettings = computed(() => {
    return !streamBusy.value && streamRunning.value && isHardwareConnected.value
  })
  const canToggleStream = computed(() => {
    if (streamRunning.value) {
      return !streamBusy.value
    }

    return !streamBusy.value && isHardwareConnected.value
  })
  const actualHzLabel = computed(() => formatActualHz(displayActualHz.value))
  const effectiveStreamRateHz = computed(() => {
    return Math.max(streamStatus.value.actual_hz, streamStatus.value.target_hz, 1)
  })
  const streamScheduleLagMs = computed(() => {
    return computeStreamScheduleLagMs(streamStatus.value.queue_fill, effectiveStreamRateHz.value)
  })
  const shouldWarnStreamBacklogState = computed(() => {
    return shouldWarnStreamBacklog(streamStatus.value.queue_fill, streamScheduleLagMs.value)
  })

  function resetDisplayActualHz(rateHz = 0) {
    const nextRate = Number.isFinite(rateHz) && rateHz > 0 ? rateHz : 0
    displayActualHz.value = nextRate
    displayActualHzSamples.length = nextRate > 0 ? 1 : 0
    if (nextRate > 0) {
      displayActualHzSamples[0] = nextRate
    }
    displayActualHzPendingSamples = 0
  }

  function tickDisplayActualHz() {
    if (!streamRunning.value) {
      resetDisplayActualHz()
      return
    }

    const rawActualHz = streamStatus.value.actual_hz
    if (!Number.isFinite(rawActualHz) || rawActualHz <= 0) {
      return
    }

    displayActualHzSamples.push(rawActualHz)
    while (displayActualHzSamples.length > DISPLAY_ACTUAL_HZ_SAMPLE_WINDOW) {
      displayActualHzSamples.shift()
    }

    if (displayActualHzPendingSamples > 0) {
      displayActualHzPendingSamples -= 1
      if (displayActualHzPendingSamples > 0) {
        return
      }
    }

    displayActualHz.value = median(displayActualHzSamples)
  }

  function parseRequestedRate() {
    const nextRate = Number(rateInput.value)
    if (!Number.isFinite(nextRate) || nextRate <= 0) {
      throw new Error(t('frequencyInvalid'))
    }

    return nextRate
  }

  async function syncStreamConfig() {
    await hardwareWorkbenchStore.syncStreamSignalMap()
  }

  async function applyStreamSettings() {
    if (!canApplySettings.value) {
      return
    }

    streamBusy.value = true
    streamMessage.value = ''

    try {
      const nextRate = parseRequestedRate()
      const timingChanged =
        streamStatus.value.vericomm_clock_high_delay !== HARDWARE_STREAM_CLOCK_DELAY ||
        streamStatus.value.vericomm_clock_low_delay !== HARDWARE_STREAM_CLOCK_DELAY
      await syncStreamConfig()
      await hardwareStore.setDataStreamRate(nextRate)

      if (streamRunning.value && timingChanged) {
        await hardwareStore.stopDataStream()
        await hardwareStore.startDataStream()
      }
    } catch (error) {
      streamMessage.value = getErrorMessage(error)
    } finally {
      streamBusy.value = false
    }
  }

  async function startStream() {
    if (!canToggleStream.value || !isHardwareConnected.value) {
      return
    }

    streamBusy.value = true
    streamMessage.value = ''

    try {
      await syncStreamConfig()
      await hardwareStore.setDataStreamRate(parseRequestedRate())
      await hardwareStore.startDataStream()
    } catch (error) {
      streamMessage.value = t('failedToStartStream', { message: getErrorMessage(error) })
    } finally {
      streamBusy.value = false
    }
  }

  async function stopStream() {
    streamBusy.value = true
    streamMessage.value = ''

    try {
      await hardwareStore.stopDataStream()
    } catch (error) {
      streamMessage.value = t('failedToStopStream', { message: getErrorMessage(error) })
    } finally {
      streamBusy.value = false
    }
  }

  async function toggleStream() {
    if (streamRunning.value) {
      await stopStream()
      return
    }

    await startStream()
  }

  watch(
    () => streamStatus.value.target_hz,
    (targetHz, previousTargetHz) => {
      rateInput.value = formatRate(targetHz)

      if (previousTargetHz === undefined) {
        return
      }

      if (!streamRunning.value) {
        resetDisplayActualHz()
        return
      }

      displayActualHzSamples.length = 0
      displayActualHzPendingSamples = DISPLAY_ACTUAL_HZ_CONFIRMATION_SAMPLES
    },
    { immediate: true },
  )

  watch(
    () => streamRunning.value,
    (running) => {
      resetDisplayActualHz(running ? streamStatus.value.actual_hz : 0)
    },
    { immediate: true },
  )

  onMounted(() => {
    if (typeof window !== 'undefined') {
      displayActualHzTimer = setInterval(() => {
        tickDisplayActualHz()
      }, DISPLAY_ACTUAL_HZ_INTERVAL_MS)
    }
  })

  onBeforeUnmount(() => {
    if (displayActualHzTimer !== null) {
      clearInterval(displayActualHzTimer)
      displayActualHzTimer = null
    }
  })

  return {
    actualHzLabel,
    applyStreamSettings,
    canApplySettings,
    canToggleStream,
    rateInput,
    shouldWarnStreamBacklog: shouldWarnStreamBacklogState,
    streamRunning,
    streamScheduleLagMs,
    streamStatus,
    toggleStream,
  }
}
