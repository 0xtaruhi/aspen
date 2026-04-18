import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import type { ComputedRef, Ref } from 'vue'

import { computed, ref, watch } from 'vue'

import { getCanvasDeviceBoundSignal, getCanvasDeviceBoundSignals } from '@/lib/canvas-devices'
import { useI18n } from '@/lib/i18n'
import { isLikelyClockPort } from '@/lib/project-constraints'
import { normalizeUniqueSignalNames } from '@/lib/signal-names'
import { hardwareStore } from '@/stores/hardware'
import { projectWaveformStore } from '@/stores/project-waveform'
import { signalCatalogStore } from '@/stores/signal-catalog'

import { orderWaveformSignals } from './waveform-helpers'

type UseVirtualDevicePlatformWaveformOptions = {
  allSignalNameSet: ComputedRef<Set<string>>
  canvasDevices: ComputedRef<CanvasDeviceSnapshot[]>
  selectedDeviceIds: Ref<string[]>
  streamMessage: Ref<string>
  streamObservableSignals: ComputedRef<string[]>
  describeError: (error: unknown) => string
}

export function useVirtualDevicePlatformWaveform({
  allSignalNameSet,
  canvasDevices,
  selectedDeviceIds,
  streamMessage,
  streamObservableSignals,
  describeError,
}: UseVirtualDevicePlatformWaveformOptions) {
  const { t } = useI18n()
  const waveformPanelOpen = ref(false)
  const waveformToggleErrorMessage = ref('')

  const waveformSignals = computed(() => {
    const clockSignals = signalCatalogStore.streamInputSignalOrder.value.filter((signal) => {
      return allSignalNameSet.value.has(signal) && isLikelyClockPort(signal)
    })
    const selectedSignals = selectedDeviceIds.value.flatMap((deviceId) => {
      const device = canvasDevices.value.find((entry) => entry.id === deviceId)
      if (!device) {
        return []
      }

      return [getCanvasDeviceBoundSignal(device), ...getCanvasDeviceBoundSignals(device)]
    })
    const uniqueSelectedSignals = normalizeUniqueSignalNames(
      selectedSignals.filter((signal): signal is string => Boolean(signal)),
    ).filter((signal) => allSignalNameSet.value.has(signal))

    const derivedSignals =
      selectedDeviceIds.value.length > 0
        ? normalizeUniqueSignalNames([...clockSignals, ...uniqueSelectedSignals])
        : streamObservableSignals.value

    return orderWaveformSignals(derivedSignals, projectWaveformStore.signalOrder.value)
  })

  function toggleWaveformPanel() {
    waveformPanelOpen.value = !waveformPanelOpen.value
  }

  function resetWaveformUiState() {
    waveformPanelOpen.value = false
    waveformToggleErrorMessage.value = ''
  }

  watch(
    [waveformPanelOpen, waveformSignals],
    ([open, signals], previous, onCleanup) => {
      hardwareStore.setWaveformTrackedSignals(open ? signals : [])

      const previousOpen = previous?.[0]
      if (previousOpen === open) {
        return
      }

      let stale = false
      onCleanup(() => {
        stale = true
      })

      void hardwareStore
        .setWaveformEnabled(open)
        .then(() => {
          if (stale) {
            return
          }

          if (streamMessage.value === waveformToggleErrorMessage.value) {
            waveformToggleErrorMessage.value = ''
            streamMessage.value = ''
          }
        })
        .catch((error) => {
          if (stale) {
            return
          }

          waveformToggleErrorMessage.value = t('failedToToggleWaveformPanel', {
            message: describeError(error),
          })
          console.error('Failed to update waveform panel state', error)
          streamMessage.value = waveformToggleErrorMessage.value
        })
    },
    { immediate: true },
  )

  return {
    resetWaveformUiState,
    toggleWaveformPanel,
    waveformPanelOpen,
    waveformSignals,
  }
}
