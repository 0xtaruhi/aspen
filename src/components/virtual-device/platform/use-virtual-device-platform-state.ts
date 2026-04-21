import type { CanvasInteractionMode } from './types'

import { computed, ref, watch } from 'vue'

import { getCanvasDeviceBoundSignal, getCanvasDeviceBoundSignals } from '@/lib/canvas-devices'
import { useI18n } from '@/lib/i18n'
import { normalizeUniqueSignalNames } from '@/lib/signal-names'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'
import { projectStore } from '@/stores/project'
import { signalCatalogStore } from '@/stores/signal-catalog'

import { getErrorMessage } from './error-helpers'
import { STREAM_SIGNAL_LIMIT } from './stream-helpers'
import { useVirtualDevicePlatformDevices } from './use-virtual-device-platform-devices'
import { useVirtualDevicePlatformStream } from './use-virtual-device-platform-stream'
import { useVirtualDevicePlatformWaveform } from './use-virtual-device-platform-waveform'

export function useVirtualDevicePlatformState() {
  const { t } = useI18n()
  const showGallery = ref(false)
  const canvasInteractionMode = ref<CanvasInteractionMode>('select')
  const streamBusy = ref(false)
  const streamMessage = ref('')
  const galleryDropBlockInset = 60

  const hasAnySynthesisSignals = signalCatalogStore.hasSignalSourceReport
  const hasStaleSynthesisSignals = signalCatalogStore.hasStaleSignalSourceReport
  const hasSelectedSource = computed(() => Boolean(designContextStore.selectedSource.value))
  const streamObservableSignals = computed(() => {
    return normalizeUniqueSignalNames([
      ...signalCatalogStore.streamInputSignalOrder.value,
      ...signalCatalogStore.streamOutputSignalOrder.value,
    ])
  })
  const availableSignalCount = computed(() => streamObservableSignals.value.length)
  const streamSignalNames = computed(() => {
    return streamObservableSignals.value.slice(0, STREAM_SIGNAL_LIMIT)
  })
  const streamSignalOverflow = computed(() => {
    return Math.max(0, availableSignalCount.value - streamSignalNames.value.length)
  })
  const allSignalNameSet = computed(() => {
    return new Set(signalCatalogStore.signals.value.map((signal) => signal.name))
  })
  const workbenchSignalNameSet = computed(() => {
    return new Set(signalCatalogStore.workbenchSignals.value.map((signal) => signal.name))
  })
  const canvasDevices = computed(() => hardwareStore.canvasDevices.value)
  const canvasBindingSignature = computed(() => {
    return canvasDevices.value
      .map((device) => {
        if (device.state.binding.kind === 'single') {
          return `${device.id}:single:${getCanvasDeviceBoundSignal(device) ?? ''}`
        }

        return `${device.id}:slots:${getCanvasDeviceBoundSignals(device).join('|')}`
      })
      .join('\u0000')
  })
  const canvasSessionKey = computed(() => String(projectStore.sessionId))

  const {
    actualHzLabel,
    applyStreamSettings,
    canApplySettings,
    canToggleStream,
    rateInput,
    shouldWarnStreamBacklog,
    streamRunning,
    streamScheduleLagMs,
    streamStatus,
    toggleStream,
  } = useVirtualDevicePlatformStream({
    streamBusy,
    streamMessage,
  })
  const {
    clearCanvas,
    closeManualDialog,
    inspectorOpen,
    manualDevice,
    manualDialogOpen,
    openInspectorForDevice,
    openManualForSelectedDevice,
    resetDeviceUiState,
    selectedDevice,
    selectedDeviceId,
    selectedDeviceIds,
  } = useVirtualDevicePlatformDevices({
    canvasDevices,
    streamBusy,
    streamMessage,
    describeError: getErrorMessage,
  })
  const { resetWaveformUiState, toggleWaveformPanel, waveformPanelOpen, waveformSignals } =
    useVirtualDevicePlatformWaveform({
      allSignalNameSet,
      canvasDevices,
      selectedDeviceIds,
      streamMessage,
      streamObservableSignals,
      describeError: getErrorMessage,
    })

  function toggleGallery() {
    showGallery.value = !showGallery.value
  }

  async function sanitizeUnsupportedBindings() {
    const allowedSignals = workbenchSignalNameSet.value

    for (const device of canvasDevices.value) {
      if (device.state.binding.kind === 'single') {
        const signal = getCanvasDeviceBoundSignal(device)
        if (signal && !allowedSignals.has(signal)) {
          await hardwareStore.bindCanvasSignal(device.id, null)
        }
        continue
      }

      const currentSignals = device.state.binding.signals
      const nextSignals = getCanvasDeviceBoundSignals(device).map((signal) => {
        return signal && !allowedSignals.has(signal) ? null : signal
      })

      const changed = nextSignals.some((signal, index) => signal !== currentSignals[index])
      if (changed) {
        await hardwareStore.upsertCanvasDevice({
          ...device,
          state: {
            ...device.state,
            binding: {
              kind: 'slots',
              signals: nextSignals,
            },
          },
        })
      }
    }
  }

  function resetPlatformUiState() {
    showGallery.value = false
    canvasInteractionMode.value = 'select'
    resetDeviceUiState()
    resetWaveformUiState()
    streamBusy.value = false
    streamMessage.value = ''
  }

  watch(
    () => projectStore.sessionId,
    () => {
      resetPlatformUiState()
    },
  )

  watch(
    [
      hasAnySynthesisSignals,
      hasStaleSynthesisSignals,
      workbenchSignalNameSet,
      canvasBindingSignature,
    ],
    ([hasSignalSourceReport, hasStaleSignalSourceReport]) => {
      if (!hasSignalSourceReport || hasStaleSignalSourceReport) {
        return
      }

      void sanitizeUnsupportedBindings().catch((error) => {
        streamMessage.value = t('failedToSanitizeVirtualDeviceBindings', {
          message: getErrorMessage(error),
        })
        console.error('Failed to sanitize unsupported virtual-device bindings', error)
      })
    },
    { immediate: true },
  )

  return {
    actualHzLabel,
    applyStreamSettings,
    availableSignalCount,
    canApplySettings,
    canToggleStream,
    canvasInteractionMode,
    canvasSessionKey,
    clearCanvas,
    closeManualDialog,
    galleryDropBlockInset,
    hasAnySynthesisSignals,
    hasSelectedSource,
    hasStaleSynthesisSignals,
    inspectorOpen,
    manualDevice,
    manualDialogOpen,
    openInspectorForDevice,
    openManualForSelectedDevice,
    rateInput,
    selectedDevice,
    selectedDeviceId,
    selectedDeviceIds,
    shouldWarnStreamBacklog,
    showGallery,
    streamMessage,
    streamRunning,
    streamScheduleLagMs,
    streamSignalNames,
    streamSignalOverflow,
    streamStatus,
    toggleGallery,
    toggleWaveformPanel,
    toggleStream,
    waveformPanelOpen,
    waveformSignals,
  }
}
