import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { getCanvasDeviceBoundSignal, getCanvasDeviceBoundSignals } from '@/lib/canvas-devices'
import { confirmAction } from '@/lib/confirm-action'
import { useI18n } from '@/lib/i18n'
import { isLikelyClockPort } from '@/lib/project-constraints'
import { normalizeUniqueSignalNames } from '@/lib/signal-names'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'
import { HARDWARE_STREAM_CLOCK_DELAY, hardwareWorkbenchStore } from '@/stores/hardware-workbench'
import { projectStore } from '@/stores/project'
import { signalCatalogStore } from '@/stores/signal-catalog'
import { settingsStore } from '@/stores/settings'

import type { CanvasInteractionMode } from './types'

import {
  computeStreamScheduleLagMs,
  formatActualHz,
  formatRate,
  median,
  shouldWarnStreamBacklog,
  STREAM_SIGNAL_LIMIT,
} from './stream-helpers'

const DISPLAY_ACTUAL_HZ_INTERVAL_MS = 250
const DISPLAY_ACTUAL_HZ_SAMPLE_WINDOW = 5
const DISPLAY_ACTUAL_HZ_CONFIRMATION_SAMPLES = 3

export function useVirtualDevicePlatformState() {
  const showGallery = ref(false)
  const canvasInteractionMode = ref<CanvasInteractionMode>('select')
  const selectedDeviceId = ref<string | null>(null)
  const selectedDeviceIds = ref<string[]>([])
  const inspectorOpen = ref(false)
  const manualDialogOpen = ref(false)
  const manualDeviceId = ref<string | null>(null)
  const reopenInspectorAfterManual = ref(false)
  const waveformPanelOpen = ref(false)
  const streamBusy = ref(false)
  const streamMessage = ref('')
  const waveformToggleErrorMessage = ref('')
  const rateInput = ref<string | number>('1000')
  const displayActualHz = ref(0)
  const displayActualHzSamples: number[] = []
  const galleryDropBlockInset = 60
  let displayActualHzPendingSamples = 0
  let displayActualHzTimer: ReturnType<typeof setInterval> | null = null
  const { t } = useI18n()

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
  const hasCanvasDevices = computed(() => canvasDevices.value.length > 0)
  const selectedDeviceCount = computed(() => selectedDeviceIds.value.length)
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
  const canvasSessionKey = computed(() => String(projectStore.sessionId))
  const effectiveStreamRateHz = computed(() => {
    return Math.max(streamStatus.value.actual_hz, streamStatus.value.target_hz, 1)
  })
  const streamScheduleLagMs = computed(() => {
    return computeStreamScheduleLagMs(streamStatus.value.queue_fill, effectiveStreamRateHz.value)
  })
  const shouldWarnStreamBacklogState = computed(() => {
    return shouldWarnStreamBacklog(streamStatus.value.queue_fill, streamScheduleLagMs.value)
  })
  const selectedDevice = computed(() => {
    if (!selectedDeviceId.value) {
      return null
    }

    return canvasDevices.value.find((device) => device.id === selectedDeviceId.value) ?? null
  })
  const manualDevice = computed(() => {
    if (!manualDeviceId.value) {
      return null
    }

    return canvasDevices.value.find((device) => device.id === manualDeviceId.value) ?? null
  })
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

    // Compute the derived signal order (clockSignals then selected signals, or all observable signals)
    const derivedSignals =
      selectedDeviceIds.value.length > 0
        ? normalizeUniqueSignalNames([...clockSignals, ...uniqueSelectedSignals])
        : streamObservableSignals.value

    // Get existing tracked signal order from waveformTracks
    const existingTrackedSignals = hardwareStore.waveformTrackedSignals.value

    // If there are no existing tracked signals, fall back to the derived ordering
    if (existingTrackedSignals.length === 0) {
      return derivedSignals
    }

    // Preserve existing order by filtering to signals still present in allSignalNameSet
    const preservedSignals = existingTrackedSignals.filter((signal) =>
      allSignalNameSet.value.has(signal),
    )

    // Create a set of preserved signals for fast lookup
    const preservedSignalSet = new Set(preservedSignals)

    // Append any missing signals from the derived set
    const missingSignals = derivedSignals.filter((signal) => !preservedSignalSet.has(signal))

    return normalizeUniqueSignalNames([...preservedSignals, ...missingSignals])
  })
  function toggleGallery() {
    showGallery.value = !showGallery.value
  }

  function toggleWaveformPanel() {
    waveformPanelOpen.value = !waveformPanelOpen.value
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

  function openInspectorForDevice(id: string) {
    selectedDeviceIds.value = [id]
    selectedDeviceId.value = id
    inspectorOpen.value = true
  }

  function openManualForSelectedDevice() {
    if (!selectedDevice.value) {
      return
    }

    manualDeviceId.value = selectedDevice.value.id
    reopenInspectorAfterManual.value = inspectorOpen.value
    inspectorOpen.value = false
    manualDialogOpen.value = true
  }

  function closeManualDialog() {
    manualDialogOpen.value = false
    manualDeviceId.value = null

    if (reopenInspectorAfterManual.value && selectedDevice.value) {
      inspectorOpen.value = true
    }

    reopenInspectorAfterManual.value = false
  }

  function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error)
  }

  function resetPlatformUiState() {
    showGallery.value = false
    canvasInteractionMode.value = 'select'
    selectedDeviceId.value = null
    selectedDeviceIds.value = []
    inspectorOpen.value = false
    manualDialogOpen.value = false
    manualDeviceId.value = null
    reopenInspectorAfterManual.value = false
    waveformPanelOpen.value = false
    streamBusy.value = false
    streamMessage.value = ''
  }

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

  async function clearCanvas() {
    if (!hasCanvasDevices.value) {
      return
    }

    if (
      !(await confirmAction(t('clearCanvasConfirm'), {
        title: t('clearCanvasTitle'),
      }))
    ) {
      return
    }

    streamBusy.value = true
    streamMessage.value = ''

    try {
      inspectorOpen.value = false
      selectedDeviceId.value = null
      selectedDeviceIds.value = []
      await hardwareStore.clearCanvasDevices()
    } catch (error) {
      streamMessage.value = getErrorMessage(error)
    } finally {
      streamBusy.value = false
    }
  }

  function isEditableTarget(target: EventTarget | null) {
    if (!(target instanceof HTMLElement)) {
      return false
    }

    return (
      target.isContentEditable ||
      ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) ||
      Boolean(target.closest('[contenteditable="true"]'))
    )
  }

  async function deleteSelectedDevices() {
    const ids = [...selectedDeviceIds.value]
    if (ids.length === 0) {
      return
    }

    const devicesById = new Map(canvasDevices.value.map((device) => [device.id, device]))
    const singleDevice = ids.length === 1 ? (devicesById.get(ids[0]) ?? null) : null

    if (
      settingsStore.state.confirmDelete &&
      !(await confirmAction(
        singleDevice
          ? t('deleteDeviceConfirm', { name: singleDevice.label })
          : t('deleteSelectedDevicesConfirm', { count: ids.length }),
        {
          title: singleDevice ? t('deleteDeviceTitle') : t('deleteSelectedDevicesTitle'),
        },
      ))
    ) {
      return
    }

    streamBusy.value = true
    streamMessage.value = ''

    try {
      inspectorOpen.value = false
      selectedDeviceId.value = null
      selectedDeviceIds.value = []

      for (const id of ids) {
        await hardwareStore.removeCanvasDevice(id)
      }
    } catch (error) {
      streamMessage.value = getErrorMessage(error)
    } finally {
      streamBusy.value = false
    }
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    if (
      event.defaultPrevented ||
      (event.key !== 'Delete' && event.key !== 'Backspace') ||
      isEditableTarget(event.target) ||
      selectedDeviceIds.value.length === 0
    ) {
      return
    }

    event.preventDefault()
    void deleteSelectedDevices()
  }

  watch(selectedDevice, (device) => {
    if (!device) {
      inspectorOpen.value = false
    }
  })

  watch(manualDevice, (device) => {
    if (!device && manualDialogOpen.value) {
      manualDialogOpen.value = false
      manualDeviceId.value = null
      reopenInspectorAfterManual.value = false
    }
  })

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

      void sanitizeUnsupportedBindings().catch(() => undefined)
    },
    { immediate: true },
  )

  watch(
    [waveformPanelOpen, waveformSignals],
    ([open, signals], previous, onCleanup) => {
      hardwareStore.setWaveformTrackedSignals(open ? signals : [])

      // Only call setWaveformEnabled when waveformPanelOpen actually changes
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
            message: getErrorMessage(error),
          })
          console.error('Failed to update waveform panel state', error)
          streamMessage.value = waveformToggleErrorMessage.value
        })
    },
    { immediate: true },
  )

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
      window.addEventListener('keydown', handleGlobalKeydown, { capture: true })
      displayActualHzTimer = setInterval(() => {
        tickDisplayActualHz()
      }, DISPLAY_ACTUAL_HZ_INTERVAL_MS)
    }
  })

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleGlobalKeydown, { capture: true })
      if (displayActualHzTimer !== null) {
        clearInterval(displayActualHzTimer)
        displayActualHzTimer = null
      }
    }
  })

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
    deleteSelectedDevices,
    galleryDropBlockInset,
    hasAnySynthesisSignals,
    hasCanvasDevices,
    hasSelectedSource,
    hasStaleSynthesisSignals,
    inspectorOpen,
    manualDevice,
    manualDialogOpen,
    openInspectorForDevice,
    openManualForSelectedDevice,
    rateInput,
    selectedDevice,
    selectedDeviceCount,
    selectedDeviceId,
    selectedDeviceIds,
    shouldWarnStreamBacklog: shouldWarnStreamBacklogState,
    showGallery,
    streamBusy,
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