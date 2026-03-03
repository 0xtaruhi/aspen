import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { ref } from 'vue'

import {
  type CanvasDeviceType,
  hardwareDispatch,
  hardwareGetState,
  listenHardwareStateChanged,
  type CanvasDeviceSnapshot,
  type HardwareActionV1,
  type HardwareEventV1,
  type HardwareStateV1,
} from '@/lib/hardware-client'
import {
  createCanvasDeviceSnapshot,
  deviceDrivesSignal as deviceTypeDrivesSignal,
  deviceReceivesSignal as deviceTypeReceivesSignal,
} from '@/lib/canvas-devices'

const defaultCanvasDevices: CanvasDeviceSnapshot[] = [
  createCanvasDeviceSnapshot('led', '1', 100, 100, 0),
  createCanvasDeviceSnapshot('switch', '2', 300, 100, 0),
]

const initialState: HardwareStateV1 = {
  version: 1,
  phase: 'idle',
  device: null,
  artifact: null,
  canvas_devices: defaultCanvasDevices,
  last_error: null,
  op_id: null,
  updated_at_ms: 0,
}

type HotplugPayload = {
  kind: 'arrived' | 'left'
}

const state = ref<HardwareStateV1>({ ...initialState })
const hotplugLog = ref('')
const isStarted = ref(false)

let unlistenStateChanged: UnlistenFn | null = null
let unlistenHotplug: UnlistenFn | null = null

function setState(nextState: HardwareStateV1) {
  state.value = nextState
}

function setError(message: string) {
  state.value = {
    ...state.value,
    phase: 'error',
    last_error: message,
    updated_at_ms: Date.now(),
  }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function isTauriUnavailable(err: unknown): boolean {
  const message = getErrorMessage(err)
  return (
    message.includes('__TAURI_INTERNALS__') ||
    message.includes('window.__TAURI_INTERNALS__') ||
    message.includes('plugin')
  )
}

function cloneCanvasDevices() {
  return state.value.canvas_devices.map((device) => ({
    ...device,
    state: { ...device.state },
  }))
}

function deviceDrivesSignal(type: CanvasDeviceType): boolean {
  return deviceTypeDrivesSignal(type)
}

function deviceReceivesSignal(type: CanvasDeviceType): boolean {
  return deviceTypeReceivesSignal(type)
}

function signalSourceValue(devices: CanvasDeviceSnapshot[], signal: string): boolean | null {
  const source = devices.find((candidate) => {
    return deviceDrivesSignal(candidate.type) && candidate.state.bound_signal === signal
  })
  return source ? source.state.is_on : null
}

function propagateSignalToSubscribers(
  devices: CanvasDeviceSnapshot[],
  sourceId: string,
  signal: string,
  value: boolean,
) {
  for (const candidate of devices) {
    if (candidate.id === sourceId) {
      continue
    }

    if (deviceReceivesSignal(candidate.type) && candidate.state.bound_signal === signal) {
      candidate.state.is_on = value
    }
  }
}

function reconcileBoundSignal(devices: CanvasDeviceSnapshot[], targetId: string) {
  const target = devices.find((candidate) => candidate.id === targetId)
  if (!target || !target.state.bound_signal) {
    return
  }

  const signal = target.state.bound_signal
  if (deviceDrivesSignal(target.type)) {
    propagateSignalToSubscribers(devices, target.id, signal, target.state.is_on)
    return
  }

  if (deviceReceivesSignal(target.type)) {
    const sourceValue = signalSourceValue(devices, signal)
    if (sourceValue !== null) {
      target.state.is_on = sourceValue
    }
  }
}

function applyLocalAction(action: HardwareActionV1) {
  const nextDevices = cloneCanvasDevices()

  switch (action.type) {
    case 'upsert_canvas_device': {
      const index = nextDevices.findIndex((device) => device.id === action.device.id)
      if (index >= 0) {
        nextDevices[index] = {
          ...action.device,
          state: { ...action.device.state },
        }
      } else {
        nextDevices.push({
          ...action.device,
          state: { ...action.device.state },
        })
      }
      break
    }
    case 'remove_canvas_device': {
      state.value = {
        ...state.value,
        canvas_devices: nextDevices.filter((device) => device.id !== action.id),
        updated_at_ms: Date.now(),
      }
      return
    }
    case 'set_canvas_device_position': {
      const device = nextDevices.find((item) => item.id === action.id)
      if (device) {
        device.x = action.x
        device.y = action.y
      }
      break
    }
    case 'bind_canvas_signal': {
      const device = nextDevices.find((item) => item.id === action.id)
      if (device) {
        device.state.bound_signal = action.signal_name ?? null
        reconcileBoundSignal(nextDevices, action.id)
      }
      break
    }
    case 'set_canvas_switch_state': {
      const device = nextDevices.find((item) => item.id === action.id)
      if (device) {
        device.state.is_on = action.is_on

        if (deviceDrivesSignal(device.type) && device.state.bound_signal) {
          propagateSignalToSubscribers(
            nextDevices,
            device.id,
            device.state.bound_signal,
            action.is_on,
          )
        }
      }
      break
    }
    case 'clear_error': {
      state.value = {
        ...state.value,
        last_error: null,
        phase:
          state.value.phase === 'error'
            ? state.value.device
              ? 'device_ready'
              : 'idle'
            : state.value.phase,
        updated_at_ms: Date.now(),
      }
      return
    }
    default:
      state.value = {
        ...state.value,
        updated_at_ms: Date.now(),
      }
      return
  }

  state.value = {
    ...state.value,
    canvas_devices: nextDevices,
    updated_at_ms: Date.now(),
  }
}

async function syncState() {
  try {
    const nextState = await hardwareGetState()
    setState(nextState)
    return nextState
  } catch (err) {
    if (isTauriUnavailable(err)) {
      return state.value
    }
    throw err
  }
}

async function dispatch(action: HardwareActionV1) {
  try {
    const nextState = await hardwareDispatch(action)
    setState(nextState)
    return nextState
  } catch (err) {
    if (isTauriUnavailable(err)) {
      applyLocalAction(action)
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

async function upsertCanvasDevice(device: CanvasDeviceSnapshot) {
  return dispatch({
    type: 'upsert_canvas_device',
    device,
  })
}

async function removeCanvasDevice(id: string) {
  return dispatch({
    type: 'remove_canvas_device',
    id,
  })
}

async function setCanvasDevicePosition(id: string, x: number, y: number) {
  return dispatch({
    type: 'set_canvas_device_position',
    id,
    x,
    y,
  })
}

async function bindCanvasSignal(id: string, signalName: string) {
  return dispatch({
    type: 'bind_canvas_signal',
    id,
    signal_name: signalName,
  })
}

async function setCanvasSwitchState(id: string, isOn: boolean) {
  return dispatch({
    type: 'set_canvas_switch_state',
    id,
    is_on: isOn,
  })
}

async function start() {
  if (isStarted.value) {
    return
  }

  try {
    await syncState()

    unlistenStateChanged = await listenHardwareStateChanged((event: HardwareEventV1) => {
      setState(event.state)
    })

    unlistenHotplug = await listen<HotplugPayload>('hardware:hotplug', (event) => {
      hotplugLog.value = event.payload.kind === 'arrived' ? 'Device connected' : 'Device removed'
    })

    await invoke('start_hotplug_watch')
    isStarted.value = true
  } catch (err) {
    if (unlistenStateChanged) {
      unlistenStateChanged()
      unlistenStateChanged = null
    }
    if (unlistenHotplug) {
      unlistenHotplug()
      unlistenHotplug = null
    }
    setError(err instanceof Error ? err.message : String(err))
    throw err
  }
}

async function stop() {
  if (!isStarted.value) {
    return
  }

  try {
    await invoke('stop_hotplug_watch')
  } finally {
    if (unlistenStateChanged) {
      unlistenStateChanged()
      unlistenStateChanged = null
    }
    if (unlistenHotplug) {
      unlistenHotplug()
      unlistenHotplug = null
    }
    isStarted.value = false
  }
}

async function disconnectView() {
  await stop()
  state.value = { ...initialState }
  hotplugLog.value = ''
}

export const hardwareStore = {
  state,
  hotplugLog,
  isStarted,
  start,
  stop,
  probe,
  dispatch,
  syncState,
  generateBitstream,
  programBitstream,
  upsertCanvasDevice,
  removeCanvasDevice,
  setCanvasDevicePosition,
  bindCanvasSignal,
  setCanvasSwitchState,
  clearError,
  disconnectView,
}
