<script setup lang="ts">
import DeviceCanvas from '@/components/canvas/DeviceCanvas.vue'
import ComponentGallery from '@/components/ComponentGallery.vue'
import RightDrawer from '@/components/RightDrawer.vue'
import DeviceInspector from '@/components/virtual-device/DeviceInspector.vue'
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
  deleteSelectedDevices,
  galleryDropBlockInset,
  galleryTitle,
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
  shouldWarnStreamBacklog,
  showGallery,
  streamBusy,
  streamMessage,
  streamRunning,
  streamScheduleLagMs,
  streamSignalNames,
  streamSignalOverflow,
  streamStatus,
  toggleGallery,
  toggleStream,
} = useVirtualDevicePlatformState()
</script>

<template>
  <div class="h-full flex flex-col bg-transparent">
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
