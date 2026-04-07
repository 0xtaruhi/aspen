<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Hand, LayoutGrid, Play, ScanSearch, Square, Trash2 } from 'lucide-vue-next'

import DeviceCanvas from '@/components/canvas/DeviceCanvas.vue'
import ComponentGallery from '@/components/ComponentGallery.vue'
import RightDrawer from '@/components/RightDrawer.vue'
import DeviceInspector from '@/components/virtual-device/DeviceInspector.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { confirmAction } from '@/lib/confirm-action'
import { useI18n } from '@/lib/i18n'
import { designContextStore } from '@/stores/design-context'
import { hardwareStore } from '@/stores/hardware'
import { HARDWARE_STREAM_CLOCK_DELAY, hardwareWorkbenchStore } from '@/stores/hardware-workbench'
import { signalCatalogStore } from '@/stores/signal-catalog'
import { settingsStore } from '@/stores/settings'

const STREAM_SIGNAL_LIMIT = 4 * 16
const DISPLAY_UPDATE_INTERVAL_MS = 1000

type CanvasInteractionMode = 'select' | 'pan'

const showGallery = ref(false)
const canvasInteractionMode = ref<CanvasInteractionMode>('select')
const selectedDeviceId = ref<string | null>(null)
const selectedDeviceIds = ref<string[]>([])
const inspectorOpen = ref(false)
const galleryDropBlockInset = 60
const streamBusy = ref(false)
const streamMessage = ref('')
const rateInput = ref<string | number>('1000')
const displayedActualHz = ref(0)
let streamStatusPollTimer: ReturnType<typeof setInterval> | null = null
let displayedHzTimer: ReturnType<typeof setInterval> | null = null
const { t } = useI18n()

const availableSignalCount = computed(() => signalCatalogStore.signals.value.length)
const hasAnySynthesisSignals = computed(() =>
  Boolean(signalCatalogStore.latestSynthesisReport.value),
)
const hasStaleSynthesisSignals = signalCatalogStore.hasStaleSynthesisReport
const streamSignalNames = computed(() => {
  return signalCatalogStore.signals.value.slice(0, STREAM_SIGNAL_LIMIT).map((signal) => signal.name)
})
const streamSignalOverflow = computed(() => {
  return Math.max(0, availableSignalCount.value - streamSignalNames.value.length)
})
const hasCanvasDevices = computed(() => hardwareStore.state.value.canvas_devices.length > 0)
const selectedDeviceCount = computed(() => selectedDeviceIds.value.length)
const streamStatus = computed(() => hardwareStore.dataStreamStatus.value)
const streamRunning = computed(() => streamStatus.value.running)
const canApplySettings = computed(() => !streamBusy.value)
const actualHzLabel = computed(() => `${formatMetric(displayedActualHz.value)} Hz`)
const galleryTitle = computed(() => {
  return showGallery.value ? t('hideComponentGallery') : t('openComponentGallery')
})
const effectiveStreamRateHz = computed(() => {
  return Math.max(streamStatus.value.actual_hz, streamStatus.value.target_hz, 1)
})
const streamScheduleLagMs = computed(() => {
  if (streamStatus.value.queue_fill <= 0) {
    return 0
  }

  return (streamStatus.value.queue_fill / effectiveStreamRateHz.value) * 1000
})
const streamBacklogWarningThresholdMs = computed(() => {
  const queueCapacity = streamStatus.value.queue_capacity
  if (queueCapacity <= 0) {
    return 50
  }

  const batchLagMs = (queueCapacity / effectiveStreamRateHz.value) * 1000
  return Math.min(50, batchLagMs)
})
const shouldWarnStreamBacklog = computed(() => {
  return (
    streamStatus.value.queue_fill > 0 &&
    streamScheduleLagMs.value >= streamBacklogWarningThresholdMs.value
  )
})
const selectedDevice = computed(() => {
  if (!selectedDeviceId.value) {
    return null
  }

  return (
    hardwareStore.state.value.canvas_devices.find(
      (device) => device.id === selectedDeviceId.value,
    ) ?? null
  )
})

function toggleGallery() {
  showGallery.value = !showGallery.value
}

function clearStreamStatusPollTimer() {
  if (streamStatusPollTimer !== null) {
    clearInterval(streamStatusPollTimer)
    streamStatusPollTimer = null
  }
}

function clearDisplayedHzTimer() {
  if (displayedHzTimer !== null) {
    clearInterval(displayedHzTimer)
    displayedHzTimer = null
  }
}

function startStreamStatusPolling() {
  clearStreamStatusPollTimer()
  streamStatusPollTimer = setInterval(() => {
    void hardwareStore.refreshDataStreamStatus().catch((err) => {
      streamMessage.value = t('failedRefreshStreamStatus', { message: getErrorMessage(err) })
    })
  }, 250)
}

function startDisplayedHzTimer() {
  clearDisplayedHzTimer()
  displayedHzTimer = setInterval(() => {
    displayedActualHz.value = streamStatus.value.actual_hz
  }, DISPLAY_UPDATE_INTERVAL_MS)
}

function openInspectorForDevice(id: string) {
  selectedDeviceIds.value = [id]
  selectedDeviceId.value = id
  inspectorOpen.value = true
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

function formatMetric(rateHz: number) {
  if (!Number.isFinite(rateHz) || rateHz <= 0) {
    return '0'
  }

  if (rateHz >= 1_000_000) {
    return `${(rateHz / 1_000_000).toFixed(2).replace(/\.?0+$/, '')}M`
  }

  if (rateHz >= 1_000) {
    return `${(rateHz / 1_000).toFixed(1).replace(/\.?0+$/, '')}k`
  }

  return Math.round(rateHz).toString()
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

  const devicesById = new Map(
    hardwareStore.state.value.canvas_devices.map((device) => [device.id, device]),
  )
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

watch(
  streamRunning,
  (running) => {
    if (running) {
      startStreamStatusPolling()
      startDisplayedHzTimer()
      return
    }

    clearStreamStatusPollTimer()
    clearDisplayedHzTimer()
    displayedActualHz.value = 0
  },
  { immediate: true },
)

watch(
  () => streamStatus.value.target_hz,
  (targetHz) => {
    rateInput.value = formatRate(targetHz)
  },
  { immediate: true },
)

onMounted(() => {
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleGlobalKeydown, { capture: true })
  }
})

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('keydown', handleGlobalKeydown, { capture: true })
  }

  clearStreamStatusPollTimer()
  clearDisplayedHzTimer()
})
</script>

<template>
  <div class="h-full flex flex-col bg-background">
    <div class="h-12 border-b border-border bg-muted/20 px-4 flex items-center gap-3">
      <div class="flex items-center gap-1">
        <Button
          type="button"
          size="icon"
          variant="outline"
          :title="galleryTitle"
          :aria-label="t('toggleComponentGallery')"
          @pointerdown.stop
          @click.stop="toggleGallery"
        >
          <LayoutGrid class="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          :variant="canvasInteractionMode === 'pan' ? 'default' : 'outline'"
          :title="t('canvasPanTool')"
          :aria-label="t('canvasPanTool')"
          :aria-pressed="canvasInteractionMode === 'pan'"
          @click="canvasInteractionMode = 'pan'"
        >
          <Hand class="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          :variant="canvasInteractionMode === 'select' ? 'default' : 'outline'"
          :title="t('canvasSelectTool')"
          :aria-label="t('canvasSelectTool')"
          :aria-pressed="canvasInteractionMode === 'select'"
          @click="canvasInteractionMode = 'select'"
        >
          <ScanSearch class="h-4 w-4" />
        </Button>
      </div>
      <Badge variant="outline">
        {{ streamRunning ? t('runningState') : t('stoppedState') }}
      </Badge>
      <Badge variant="outline">
        {{ streamStatus.configured_signal_count || streamSignalNames.length }} /
        {{ availableSignalCount }}
        {{ t('portsUnit') }}
      </Badge>
      <Badge variant="outline">{{ actualHzLabel }}</Badge>
      <div class="ml-auto flex items-center gap-2">
        <Button
          v-if="selectedDeviceCount > 0"
          type="button"
          size="sm"
          variant="outline"
          class="gap-2 text-destructive hover:text-destructive"
          :disabled="streamBusy"
          @click="deleteSelectedDevices"
        >
          <Trash2 class="h-4 w-4" />
          {{ t('deleteSelected') }}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          class="gap-2 text-destructive hover:text-destructive"
          :disabled="streamBusy || !hasCanvasDevices"
          @click="clearCanvas"
        >
          <Trash2 class="h-4 w-4" />
          {{ t('clearCanvas') }}
        </Button>
        <div class="flex items-center gap-2 rounded-md border border-border bg-background px-2">
          <span class="text-xs text-muted-foreground">Hz</span>
          <Input
            v-model="rateInput"
            type="number"
            min="0.1"
            step="1"
            class="h-8 w-24 border-0 bg-transparent px-0 text-right shadow-none focus-visible:ring-0"
            @keydown.enter.prevent="canApplySettings && applyStreamSettings()"
          />
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          :disabled="!canApplySettings"
          @click="applyStreamSettings"
        >
          {{ t('apply') }}
        </Button>
        <Button
          type="button"
          size="sm"
          :variant="streamRunning ? 'destructive' : 'default'"
          :disabled="streamBusy"
          class="gap-2"
          @click="streamRunning ? stopStream() : startStream()"
        >
          <Square v-if="streamRunning" class="h-4 w-4" />
          <Play v-else class="h-4 w-4" />
          {{ streamRunning ? t('stop') : t('start') }}
        </Button>
      </div>
    </div>

    <div
      v-if="
        streamMessage ||
        streamStatus.last_error ||
        streamStatus.dropped_samples > 0 ||
        shouldWarnStreamBacklog ||
        streamSignalOverflow > 0 ||
        (designContextStore.selectedSource.value && !hasAnySynthesisSignals) ||
        hasStaleSynthesisSignals
      "
      class="border-b border-border bg-background px-4 py-2 text-xs text-muted-foreground"
    >
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span v-if="streamStatus.last_error" class="text-destructive">
          {{ streamStatus.last_error }}
        </span>
        <span v-else-if="streamMessage" class="text-destructive">
          {{ streamMessage }}
        </span>
        <span v-if="streamStatus.dropped_samples > 0" class="text-amber-600">
          {{ t('streamDroppedWarning', { count: streamStatus.dropped_samples }) }}
        </span>
        <span v-if="shouldWarnStreamBacklog" class="text-amber-600">
          {{ t('streamLagWarning', { ms: Math.round(streamScheduleLagMs) }) }}
        </span>
        <span v-if="streamSignalOverflow > 0" class="text-amber-600">
          {{ t('streamOverflowWarning', { count: streamSignalOverflow }) }}
        </span>
        <span
          v-if="designContextStore.selectedSource.value && !hasAnySynthesisSignals"
          class="text-amber-600"
        >
          {{ t('workbenchRequiresSynthesisDescription') }}
        </span>
        <span v-else-if="hasStaleSynthesisSignals" class="text-amber-600">
          {{ t('workbenchSynthesisOutdatedDescription') }}
        </span>
      </div>
    </div>

    <div class="relative flex-1 min-h-0 overflow-hidden">
      <ComponentGallery :open="showGallery" @close="showGallery = false" />
      <DeviceCanvas
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
      <DeviceInspector :device="selectedDevice" @close="inspectorOpen = false" />
    </RightDrawer>
  </div>
</template>
