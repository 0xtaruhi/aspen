<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LayoutGrid } from 'lucide-vue-next'

import DeviceCanvas from '@/components/canvas/DeviceCanvas.vue'
import ComponentGallery from '@/components/ComponentGallery.vue'
import RightDrawer from '@/components/RightDrawer.vue'
import DeviceInspector from '@/components/virtual-device/DeviceInspector.vue'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { hardwareStore } from '@/stores/hardware'
import { signalCatalogStore } from '@/stores/signal-catalog'

const showGallery = ref(false)
const selectedDeviceId = ref<string | null>(null)
const inspectorOpen = ref(false)
const galleryDropBlockInset = 60

const availableSignalCount = computed(() => signalCatalogStore.signals.value.length)
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

function openInspectorForDevice(id: string) {
  selectedDeviceId.value = id
  inspectorOpen.value = true
}

watch(selectedDevice, (device) => {
  if (!device) {
    inspectorOpen.value = false
  }
})
</script>

<template>
  <div class="h-full flex flex-col bg-background">
    <div class="h-12 border-b border-border bg-muted/20 px-4 flex items-center gap-3">
      <Button
        type="button"
        size="icon"
        variant="outline"
        :title="showGallery ? 'Hide component gallery' : 'Open component gallery'"
        aria-label="Toggle component gallery"
        @click="toggleGallery"
      >
        <LayoutGrid class="w-4 h-4" />
      </Button>
      <Badge variant="outline">{{ availableSignalCount }} top ports</Badge>
    </div>

    <div class="relative flex-1 min-h-0 overflow-hidden">
      <ComponentGallery :open="showGallery" />
      <DeviceCanvas
        v-model:selected-device-id="selectedDeviceId"
        :blocked-top-inset="showGallery ? galleryDropBlockInset : 0"
        @open-settings="openInspectorForDevice"
      />
    </div>

    <RightDrawer
      v-model:modelValue="inspectorOpen"
      :title="selectedDevice ? `${selectedDevice.label} Settings` : 'Device Settings'"
    >
      <DeviceInspector :device="selectedDevice" @close="inspectorOpen = false" />
    </RightDrawer>
  </div>
</template>
