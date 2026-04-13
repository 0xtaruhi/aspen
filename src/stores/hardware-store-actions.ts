import type { HardwareActionV1, HardwareStateV1 } from '@/lib/hardware-client'

import type { ComputedRef } from 'vue'

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
        projectCanvasStore.applyAction(action)
        return state.value
      }
      throw err
    }
  }

  async function probe() {
    return dispatch({ type: 'probe' })
  }

  async function generateBitstream(
    sourceName: string,
    sourceCode: string,
    outputPath?: string | null,
  ) {
    return dispatch({
      type: 'generate_bitstream',
      source_name: sourceName,
      source_code: sourceCode,
      output_path: outputPath ?? null,
    })
  }

  async function programBitstream(bitstreamPath?: string | null) {
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
    generateBitstream,
    programBitstream,
    ...canvasActions,
    clearError,
  }
}
