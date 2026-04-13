import type { HardwareActionV1, HardwareStateV1 } from '@/lib/hardware-client'

import {
  hardwareDispatch,
  hardwareGetDataStreamStatus,
  hardwareGetState,
} from '@/lib/hardware-client'

import {
  isRuntimeOnlyAction,
  isTauriUnavailable,
  runtimeUnavailableMessage,
} from './hardware-runtime-errors'
import { applyDataStreamStatus } from './hardware-runtime-telemetry'
import {
  applyHardwareState,
  clearErrorLocal,
  dataStreamStatus,
  setError,
} from './hardware-runtime-state'

export async function syncState(): Promise<HardwareStateV1 | null> {
  try {
    const nextState = await hardwareGetState()
    applyHardwareState(nextState)
    return nextState
  } catch (err) {
    if (isTauriUnavailable(err)) {
      return null
    }
    throw err
  }
}

export async function refreshDataStreamStatus() {
  try {
    const status = await hardwareGetDataStreamStatus()
    applyDataStreamStatus(status)
    return status
  } catch (err) {
    if (isTauriUnavailable(err)) {
      return dataStreamStatus.value
    }
    throw err
  }
}

export async function dispatch(action: HardwareActionV1): Promise<HardwareStateV1 | null> {
  try {
    const nextState = await hardwareDispatch(action)
    applyHardwareState(nextState)
    return nextState
  } catch (err) {
    if (isTauriUnavailable(err)) {
      if (isRuntimeOnlyAction(action)) {
        setError(runtimeUnavailableMessage(action))
        return null
      }
      if (action.type === 'clear_error') {
        clearErrorLocal()
        return null
      }
    }
    throw err
  }
}
