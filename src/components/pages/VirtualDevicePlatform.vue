<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import DeviceCanvas from '@/components/canvas/DeviceCanvas.vue'
import ComponentGallery from '@/components/ComponentGallery.vue'
import RightDrawer from '@/components/RightDrawer.vue'
import DeviceInspector from '@/components/virtual-device/DeviceInspector.vue'
import VirtualDeviceManualDialog from '@/components/virtual-device/platform/VirtualDeviceManualDialog.vue'
import VirtualDeviceStatusBanner from '@/components/virtual-device/platform/VirtualDeviceStatusBanner.vue'
import VirtualDeviceToolbar from '@/components/virtual-device/platform/VirtualDeviceToolbar.vue'
import { getCanvasDeviceBoundSignal, getCanvasDeviceBoundSignals } from '@/lib/canvas-devices'
import { confirmAction } from '@/lib/confirm-action'
import { useI18n } from '@/lib/i18n'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'
import { HARDWARE_STREAM_CLOCK_DELAY, hardwareWorkbenchStore } from '@/stores/hardware-workbench'
import { projectStore } from '@/stores/project'
import { signalCatalogStore } from '@/stores/signal-catalog'
import { settingsStore } from '@/stores/settings'
import type { CanvasInteractionMode } from '@/components/virtual-device/platform/types'

const STREAM_SIGNAL_LIMIT = 4 * 16
const STREAM_LAG_WARNING_THRESHOLD_MS = 10
const DISPLAY_ACTUAL_HZ_INTERVAL_MS = 250
const DISPLAY_ACTUAL_HZ_SAMPLE_WINDOW = 5
const DISPLAY_ACTUAL_HZ_CONFIRMATION_SAMPLES = 3

const showGallery = ref(false)
const canvasInteractionMode = ref<CanvasInteractionMode>('select')
const selectedDeviceId = ref<string | null>(null)
const selectedDeviceIds = ref<string[]>([])
const inspectorOpen = ref(false)
const manualDialogOpen = ref(false)
const manualDeviceId = ref<string | null>(null)
const reopenInspectorAfterManual = ref(false)
const galleryDropBlockInset = 60
const streamBusy = ref(false)
const streamMessage = ref('')
const rateInput = ref<string | number>('1000')
const displayActualHz = ref(0)
const displayActualHzSamples: number[] = []
let displayActualHzPendingSamples = 0
let displayActualHzTimer: ReturnType<typeof setInterval> | null = null
const { t } = useI18n()

const availableSignalCount = computed(() => signalCatalogStore.workbenchSignals.value.length)
const hasAnySynthesisSignals = signalCatalogStore.hasSignalSourceReport
const hasStaleSynthesisSignals = signalCatalogStore.hasStaleSignalSourceReport
const streamSignalNames = computed(() => {
  return signalCatalogStore.workbenchSignals.value
    .slice(0, STREAM_SIGNAL_LIMIT)
    .map((signal) => signal.name)
})
const streamSignalOverflow = computed(() => {
  return Math.max(0, availableSignalCount.value - streamSignalNames.value.length)
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
const galleryTitle = computed(() => {
  return showGallery.value ? t('hideComponentGallery') : t('openComponentGallery')
})
const canvasSessionKey = computed(() => String(projectStore.sessionId))
const effectiveStreamRateHz = computed(() => {
  return Math.max(streamStatus.value.actual_hz, streamStatus.value.target_hz, 1)
})
const streamScheduleLagMs = computed(() => {
  if (streamStatus.value.queue_fill <= 0) {
    return 0
  }

  return (streamStatus.value.queue_fill / effectiveStreamRateHz.value) * 1000
})
const shouldWarnStreamBacklog = computed(() => {
  return (
    streamStatus.value.queue_fill > 0 && streamScheduleLagMs.value > STREAM_LAG_WARNING_THRESHOLD_MS
  )
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

function getErrorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err)
}

function formatRate(rateHz: number) {
  if (!Number.isFinite(rateHz) || rateHz <= 0) {
    return '1'
  }

  if (Number.isInteger(rateHz)) {
    return String(rateHz)
  }

  return rateHz.toFixed(2).replace(/\.?0+$/, '')
}

function formatActualHz(rateHz: number) {
  if (!Number.isFinite(rateHz) || rateHz <= 0) {
    return '0 Hz'
  }

  if (rateHz < 10_000) {
    return `${Math.round(rateHz)} Hz`
  }

  if (rateHz < 100_000) {
    return `${(rateHz / 1_000).toFixed(1).replace(/\.?0+$/, '')} kHz`
  }

  if (rateHz < 1_000_000) {
    return `${Math.round(rateHz / 1_000)} kHz`
  }

  return `${(rateHz / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} MHz`
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

function median(values: readonly number[]) {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) {
    return sorted[middle]
  }

  return (sorted[middle - 1] + sorted[middle]) / 2
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
  } catch (err) {
    streamMessage.value = getErrorMessage(err)
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
  } catch (err) {
    streamMessage.value = t('failedToStartStream', { message: getErrorMessage(err) })
  } finally {
    streamBusy.value = false
  }
}

async function stopStream() {
  streamBusy.value = true
  streamMessage.value = ''

  try {
    await hardwareStore.stopDataStream()
  } catch (err) {
    streamMessage.value = t('failedToStopStream', { message: getErrorMessage(err) })
  } finally {
    streamBusy.value = false
  }
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
  } catch (err) {
    streamMessage.value = getErrorMessage(err)
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
  } catch (err) {
    streamMessage.value = getErrorMessage(err)
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
  [workbenchSignalNameSet, canvasBindingSignature],
  () => {
    void sanitizeUnsupportedBindings().catch(() => undefined)
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
</script>

<template>
  <div class="h-full flex flex-col bg-background">
    <VirtualDeviceToolbar
      :show-gallery="showGallery"
      :interaction-mode="canvasInteractionMode"
      :gallery-title="galleryTitle"
      :stream-running="streamRunning"
      :configured-signal-count="streamStatus.configured_signal_count"
      :visible-signal-count="streamSignalNames.length"
      :available-signal-count="availableSignalCount"
      :actual-hz-label="actualHzLabel"
      :selected-device-count="selectedDeviceCount"
      :has-canvas-devices="hasCanvasDevices"
      :stream-busy="streamBusy"
      :rate-input="rateInput"
      :can-apply-settings="canApplySettings"
      :can-toggle-stream="canToggleStream"
      @toggle-gallery="toggleGallery"
      @update:interaction-mode="canvasInteractionMode = $event"
      @update:rate-input="rateInput = $event"
      @delete-selected="deleteSelectedDevices"
      @clear-canvas="clearCanvas"
      @apply-settings="applyStreamSettings"
      @toggle-stream="streamRunning ? stopStream() : startStream()"
    />

    <VirtualDeviceStatusBanner
      :stream-message="streamMessage"
      :stream-last-error="streamStatus.last_error"
      :dropped-samples="streamStatus.dropped_samples"
      :show-backlog-warning="shouldWarnStreamBacklog"
      :stream-schedule-lag-ms="streamScheduleLagMs"
      :stream-signal-overflow="streamSignalOverflow"
      :has-selected-source="Boolean(designContextStore.selectedSource.value)"
      :has-any-synthesis-signals="hasAnySynthesisSignals"
      :has-stale-synthesis-signals="hasStaleSynthesisSignals"
    />

    <div class="relative flex-1 min-h-0 overflow-hidden">
      <ComponentGallery :open="showGallery" @close="showGallery = false" />
      <DeviceCanvas
        :key="canvasSessionKey"
        v-model:selected-device-id="selectedDeviceId"
        v-model:selected-device-ids="selectedDeviceIds"
        :blocked-top-inset="showGallery ? galleryDropBlockInset : 0"
        :interaction-mode="canvasInteractionMode"
        @open-settings="openInspectorForDevice"
      />
    </div>

    <RightDrawer
      v-model:modelValue="inspectorOpen"
      :title="
        selectedDevice
          ? t('selectedDeviceSettings', { name: selectedDevice.label })
          : t('deviceSettingsTitle')
      "
    >
      <DeviceInspector
        :device="selectedDevice"
        @close="inspectorOpen = false"
        @open-manual="openManualForSelectedDevice"
      />
    </RightDrawer>

    <VirtualDeviceManualDialog
      :open="manualDialogOpen"
      :device="manualDevice"
      @close="closeManualDialog"
    />
  </div>
</template>
