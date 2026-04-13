import type { HardwareStateV1 } from '@/lib/hardware-client'

import { computed } from 'vue'

import { hardwareFlowStore } from './hardware-flow'
import { hardwareRuntimeStore } from './hardware-runtime'
import { projectCanvasStore } from './project-canvas'

export function createHardwareStoreView() {
  const canvasDevices = computed(() => projectCanvasStore.canvasDevices.value)
  const state = computed<HardwareStateV1>(() => {
    return {
      ...hardwareRuntimeStore.runtimeState.value,
      canvas_devices: canvasDevices.value,
    }
  })

  return {
    state,
    canvasDevices,
    signalTelemetry: hardwareRuntimeStore.signalTelemetry,
    deviceTelemetry: hardwareRuntimeStore.deviceTelemetry,
    dataStreamStatus: hardwareRuntimeStore.dataStreamStatus,
    hotplugLog: hardwareRuntimeStore.hotplugLog,
    isStarted: hardwareRuntimeStore.isStarted,
    synthesisRunning: hardwareFlowStore.synthesisRunning,
    synthesisReport: hardwareFlowStore.synthesisReport,
    synthesisReportSignature: hardwareFlowStore.synthesisReportSignature,
    synthesisLiveLog: hardwareFlowStore.synthesisLiveLog,
    synthesisMessage: hardwareFlowStore.synthesisMessage,
    implementationRunning: hardwareFlowStore.implementationRunning,
    implementationReport: hardwareFlowStore.implementationReport,
    implementationReportSignature: hardwareFlowStore.implementationReportSignature,
    implementationLiveLog: hardwareFlowStore.implementationLiveLog,
    implementationMessage: hardwareFlowStore.implementationMessage,
  }
}
