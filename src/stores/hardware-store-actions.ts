import type { HardwareActionV1, HardwareStateV1 } from '@/lib/hardware-client'

import type { ComputedRef } from 'vue'

import { syncHardwareAccess } from '@/lib/hardware-access'

import {
  dispatch as dispatchRuntimeAction,
  hardwareRuntimeStore,
  syncState as syncRuntimeState,
} from './hardware-runtime'
import { createHardwareStoreCanvasActions } from './hardware-store-canvas-actions'
import { createHardwareStoreRuntimeActions } from './hardware-store-runtime-actions'
import { isProjectCanvasAction, projectCanvasStore } from './project-canvas'

export function createHardwareStoreActions(state: ComputedRef<HardwareStateV1>) {
  async function syncState() {
    await syncRuntimeState()
    return state.value
  }

  async function dispatch(action: HardwareActionV1) {
    try {
      await dispatchRuntimeAction(action)
      if (isProjectCanvasAction(action)) {
        projectCanvasStore.applyAction(action)
      }
      return state.value
    } catch (err) {
      if (hardwareRuntimeStore.isTauriUnavailable(err)) {
        if (isProjectCanvasAction(action)) {
          projectCanvasStore.applyAction(action)
          return state.value
        }
      }
      throw err
    }
  }

  async function probe() {
    await syncHardwareAccess()
    return dispatch({ type: 'probe' })
  }

  async function programBitstream(bitstreamPath?: string | null) {
    await syncHardwareAccess()
    return dispatch({
      type: 'program_bitstream',
      bitstream_path: bitstreamPath ?? null,
    })
  }

  async function clearError() {
    return dispatch({ type: 'clear_error' })
  }

  const canvasActions = createHardwareStoreCanvasActions(state, dispatch)
  const runtimeActions = createHardwareStoreRuntimeActions()

  return {
    ...runtimeActions,
    probe,
    dispatch,
    syncState,
    programBitstream,
    ...canvasActions,
    clearError,
  }
}
