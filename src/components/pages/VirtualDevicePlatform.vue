<script setup lang="ts">
import DeviceCanvas from '@/components/canvas/DeviceCanvas.vue'
import ComponentGallery from '@/components/ComponentGallery.vue'
import RightDrawer from '@/components/RightDrawer.vue'
import DeviceInspector from '@/components/virtual-device/DeviceInspector.vue'
import WaveformPanel from '@/components/virtual-device/platform/WaveformPanel.vue'
import { useVirtualDevicePlatformState } from '@/components/virtual-device/platform/use-virtual-device-platform-state'
import VirtualDeviceManualDialog from '@/components/virtual-device/platform/VirtualDeviceManualDialog.vue'
import VirtualDeviceStatusBanner from '@/components/virtual-device/platform/VirtualDeviceStatusBanner.vue'
import VirtualDeviceToolbar from '@/components/virtual-device/platform/VirtualDeviceToolbar.vue'
const {
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
} = useVirtualDevicePlatformState()
</script>

<template>
  <div class="h-full flex flex-col bg-transparent">
    <VirtualDeviceToolbar
      :interaction-mode="canvasInteractionMode"
      :stream-running="streamRunning"
      :configured-signal-count="streamStatus.configured_signal_count"
      :visible-signal-count="streamSignalNames.length"
      :available-signal-count="availableSignalCount"
      :actual-hz-label="actualHzLabel"
      :rate-input="rateInput"
      :can-apply-settings="canApplySettings"
      :can-toggle-stream="canToggleStream"
      :waveform-panel-open="waveformPanelOpen"
      @toggle-gallery="toggleGallery"
      @toggle-waveform-panel="toggleWaveformPanel"
      @update:interaction-mode="canvasInteractionMode = $event"
      @update:rate-input="rateInput = $event"
      @apply-settings="applyStreamSettings"
      @toggle-stream="toggleStream"
    />

    <VirtualDeviceStatusBanner
      :stream-message="streamMessage"
      :stream-last-error="streamStatus.last_error"
      :dropped-samples="streamStatus.dropped_samples"
      :show-backlog-warning="shouldWarnStreamBacklog"
      :stream-schedule-lag-ms="streamScheduleLagMs"
      :stream-signal-overflow="streamSignalOverflow"
      :has-selected-source="hasSelectedSource"
      :has-any-synthesis-signals="hasAnySynthesisSignals"
      :has-stale-synthesis-signals="hasStaleSynthesisSignals"
    />

    <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div class="relative min-h-0 flex-1 overflow-hidden">
        <ComponentGallery :open="showGallery" @close="showGallery = false" />
        <DeviceCanvas
          :key="canvasSessionKey"
          v-model:selected-device-id="selectedDeviceId"
          v-model:selected-device-ids="selectedDeviceIds"
          :blocked-top-inset="showGallery ? galleryDropBlockInset : 0"
          :interaction-mode="canvasInteractionMode"
          @clear-canvas="clearCanvas"
          @open-settings="openInspectorForDevice"
        />
      </div>

      <WaveformPanel v-if="waveformPanelOpen" :signals="waveformSignals" />
    </div>

    <RightDrawer v-model:modelValue="inspectorOpen">
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
