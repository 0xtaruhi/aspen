import type { HardwareActionV1 } from '@/lib/hardware-client'

export type ProjectCanvasAction = Extract<
  HardwareActionV1,
  | { type: 'upsert_canvas_device' }
  | { type: 'remove_canvas_device' }
  | { type: 'clear_canvas_devices' }
  | { type: 'set_canvas_device_position' }
  | { type: 'bind_canvas_signal' }
  | { type: 'bind_canvas_signal_slot' }
  | { type: 'set_canvas_switch_state' }
>

export function isProjectCanvasAction(action: HardwareActionV1): action is ProjectCanvasAction {
  return (
    action.type === 'upsert_canvas_device' ||
    action.type === 'remove_canvas_device' ||
    action.type === 'clear_canvas_devices' ||
    action.type === 'set_canvas_device_position' ||
    action.type === 'bind_canvas_signal' ||
    action.type === 'bind_canvas_signal_slot' ||
    action.type === 'set_canvas_switch_state'
  )
}
