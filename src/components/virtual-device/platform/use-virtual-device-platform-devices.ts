import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import type { ComputedRef, Ref } from 'vue'

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { confirmAction } from '@/lib/confirm-action'
import { useI18n } from '@/lib/i18n'
import { hardwareStore } from '@/stores/hardware'
import { settingsStore } from '@/stores/settings'

type UseVirtualDevicePlatformDevicesOptions = {
  canvasDevices: ComputedRef<CanvasDeviceSnapshot[]>
  streamBusy: Ref<boolean>
  streamMessage: Ref<string>
  describeError: (error: unknown) => string
}

export function useVirtualDevicePlatformDevices({
  canvasDevices,
  streamBusy,
  streamMessage,
  describeError,
}: UseVirtualDevicePlatformDevicesOptions) {
  const { t } = useI18n()
  const selectedDeviceId = ref<string | null>(null)
  const selectedDeviceIds = ref<string[]>([])
  const inspectorOpen = ref(false)
  const manualDialogOpen = ref(false)
  const manualDeviceId = ref<string | null>(null)
  const reopenInspectorAfterManual = ref(false)
  const hasCanvasDevices = computed(() => canvasDevices.value.length > 0)

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

  function resetDeviceUiState() {
    selectedDeviceId.value = null
    selectedDeviceIds.value = []
    inspectorOpen.value = false
    manualDialogOpen.value = false
    manualDeviceId.value = null
    reopenInspectorAfterManual.value = false
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
      resetDeviceUiState()
      await hardwareStore.clearCanvasDevices()
    } catch (error) {
      streamMessage.value = describeError(error)
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
      resetDeviceUiState()

      for (const id of ids) {
        await hardwareStore.removeCanvasDevice(id)
      }
    } catch (error) {
      streamMessage.value = describeError(error)
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

  onMounted(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleGlobalKeydown, { capture: true })
    }
  })

  onBeforeUnmount(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleGlobalKeydown, { capture: true })
    }
  })

  return {
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
  }
}
