import { describe, expect, it } from 'vitest'

import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import { createCanvasDeviceSnapshot } from '@/lib/canvas-devices'

import { reduceProjectCanvasDevices } from './project-canvas-reducer'

function createSwitchDevice(id: string, signal: string): CanvasDeviceSnapshot {
  const device = createCanvasDeviceSnapshot('switch', id, 40, 40, 1)
  if (device.state.binding.kind !== 'single') {
    throw new Error('expected switch to use a single-signal binding')
  }

  device.state.binding.signal = signal
  return device
}

function createLedDevice(id: string, signal: string): CanvasDeviceSnapshot {
  const device = createCanvasDeviceSnapshot('led', id, 120, 40, 1)
  if (device.state.binding.kind !== 'single') {
    throw new Error('expected led to use a single-signal binding')
  }

  device.state.binding.signal = signal
  return device
}

function createSegmentDisplayDevice(id: string): CanvasDeviceSnapshot {
  const device = createCanvasDeviceSnapshot('segment_display', id, 200, 40, 1)
  if (device.state.binding.kind !== 'slots') {
    throw new Error('expected segment display to use slot bindings')
  }

  return device
}

function findDevice(devices: CanvasDeviceSnapshot[], id: string): CanvasDeviceSnapshot {
  const device = devices.find((candidate) => candidate.id === id)
  if (!device) {
    throw new Error(`missing canvas device ${id}`)
  }

  return device
}

describe('project canvas reducer', () => {
  it('reconciles slot-bound receivers immediately after a slot binding change', () => {
    const switchDevice = createSwitchDevice('switch-1', 'sig-a')
    const runningSwitch = reduceProjectCanvasDevices([switchDevice], {
      type: 'set_canvas_switch_state',
      id: 'switch-1',
      is_on: true,
    })
    const segmentDisplay = createSegmentDisplayDevice('segment-1')

    const nextDevices = reduceProjectCanvasDevices([...runningSwitch, segmentDisplay], {
      type: 'bind_canvas_signal_slot',
      id: 'segment-1',
      slot_index: 0,
      signal_name: 'sig-a',
    })

    const nextSegmentDisplay = findDevice(nextDevices, 'segment-1')
    expect(nextSegmentDisplay.state.binding.kind).toBe('slots')
    if (nextSegmentDisplay.state.binding.kind !== 'slots') {
      return
    }

    expect(nextSegmentDisplay.state.binding.signals[0]).toBe('sig-a')
    expect(nextSegmentDisplay.state.is_on).toBe(true)
  })

  it('clears stale receiver state when the last slot binding is removed', () => {
    const switchDevice = createSwitchDevice('switch-1', 'sig-a')
    const runningSwitch = reduceProjectCanvasDevices([switchDevice], {
      type: 'set_canvas_switch_state',
      id: 'switch-1',
      is_on: true,
    })
    const segmentDisplay = createSegmentDisplayDevice('segment-1')
    const boundDevices = reduceProjectCanvasDevices([...runningSwitch, segmentDisplay], {
      type: 'bind_canvas_signal_slot',
      id: 'segment-1',
      slot_index: 0,
      signal_name: 'sig-a',
    })

    const nextDevices = reduceProjectCanvasDevices(boundDevices, {
      type: 'bind_canvas_signal_slot',
      id: 'segment-1',
      slot_index: 0,
      signal_name: null,
    })

    const nextSegmentDisplay = findDevice(nextDevices, 'segment-1')
    expect(nextSegmentDisplay.state.binding.kind).toBe('slots')
    if (nextSegmentDisplay.state.binding.kind !== 'slots') {
      return
    }

    expect(nextSegmentDisplay.state.binding.signals[0]).toBeNull()
    expect(nextSegmentDisplay.state.is_on).toBe(false)
  })

  it('recomputes former subscribers when a driving device clears its binding', () => {
    const switchDevice = createSwitchDevice('switch-1', 'sig-a')
    const led = createLedDevice('led-1', 'sig-a')
    const drivenDevices = reduceProjectCanvasDevices([switchDevice, led], {
      type: 'set_canvas_switch_state',
      id: 'switch-1',
      is_on: true,
    })

    expect(findDevice(drivenDevices, 'led-1').state.is_on).toBe(true)

    const nextDevices = reduceProjectCanvasDevices(drivenDevices, {
      type: 'bind_canvas_signal',
      id: 'switch-1',
      signal_name: null,
    })

    const nextSwitch = findDevice(nextDevices, 'switch-1')
    expect(nextSwitch.state.binding.kind).toBe('single')
    if (nextSwitch.state.binding.kind !== 'single') {
      return
    }

    expect(nextSwitch.state.binding.signal).toBeNull()
    expect(findDevice(nextDevices, 'led-1').state.is_on).toBe(false)
  })
})
