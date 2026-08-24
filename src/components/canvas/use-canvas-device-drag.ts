import { onUnmounted, ref, type ComputedRef } from 'vue'

import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import {
  buildDraggedPositions,
  snapDraggedPositions,
  snapToGrid,
  type CanvasPoint,
} from '@/lib/canvas-selection'

type GroupDragState = {
  ids: string[]
  leaderId: string
  startPositions: Record<string, CanvasPoint>
}

type CanvasDeviceDragOptions = {
  devices: ComputedRef<CanvasDeviceSnapshot[]>
  selectedDeviceIds: ComputedRef<string[]>
  selectedDeviceIdSet: ComputedRef<Set<string>>
  setDevicePosition: (id: string, x: number, y: number) => Promise<unknown>
  gridSize?: number
  animationMs?: number
}

export function useCanvasDeviceDrag(options: CanvasDeviceDragOptions) {
  const gridSize = options.gridSize ?? 20
  const animationMs = options.animationMs ?? 180
  const transientDevicePositions = ref<Record<string, CanvasPoint>>({})
  const animatingDeviceIds = ref<Record<string, boolean>>({})
  const groupDragState = ref<GroupDragState | null>(null)
  const snapAnimationTimers = new Map<string, number>()

  function devicePosition(device: CanvasDeviceSnapshot): CanvasPoint {
    return transientDevicePositions.value[device.id] ?? { x: device.x, y: device.y }
  }

  function clearSnapAnimation(id: string) {
    const timer = snapAnimationTimers.get(id)
    if (timer !== undefined) {
      clearTimeout(timer)
      snapAnimationTimers.delete(id)
    }
  }

  function clearDeviceAnimation(id: string) {
    clearSnapAnimation(id)
    delete animatingDeviceIds.value[id]
  }

  function clearGroupDrag() {
    groupDragState.value = null
  }

  function startGroupDrag(id: string) {
    if (!options.selectedDeviceIdSet.value.has(id) || options.selectedDeviceIds.value.length <= 1) {
      clearGroupDrag()
      return
    }

    const startPositions: Record<string, CanvasPoint> = {}
    for (const selectedId of options.selectedDeviceIds.value) {
      const device = options.devices.value.find((candidate) => candidate.id === selectedId)
      if (device) {
        startPositions[selectedId] = devicePosition(device)
      }
    }

    groupDragState.value = {
      ids: Object.keys(startPositions),
      leaderId: id,
      startPositions,
    }
  }

  function updateDevicePosition(id: string, x: number, y: number) {
    const activeGroupDrag = groupDragState.value
    if (activeGroupDrag?.leaderId === id) {
      const draggedPositions = buildDraggedPositions(
        activeGroupDrag.ids,
        activeGroupDrag.startPositions,
        id,
        { x, y },
      )

      for (const [deviceId, position] of Object.entries(draggedPositions)) {
        clearDeviceAnimation(deviceId)
        transientDevicePositions.value[deviceId] = position
      }
      return
    }

    clearDeviceAnimation(id)
    transientDevicePositions.value[id] = { x, y }
  }

  function runNextFrame(callback: () => void) {
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(callback)
      return
    }

    window.setTimeout(callback, 16)
  }

  async function settleDevicePosition(id: string, x: number, y: number) {
    await options.setDevicePosition(id, x, y)
    delete transientDevicePositions.value[id]
    delete animatingDeviceIds.value[id]
    clearSnapAnimation(id)
  }

  function animateDeviceToPosition(id: string, targetX: number, targetY: number) {
    clearSnapAnimation(id)

    const currentDevice = options.devices.value.find((device) => device.id === id)
    const resolvedCurrent = transientDevicePositions.value[id]
      ? transientDevicePositions.value[id]
      : currentDevice
        ? { x: currentDevice.x, y: currentDevice.y }
        : null

    if (resolvedCurrent && resolvedCurrent.x === targetX && resolvedCurrent.y === targetY) {
      void settleDevicePosition(id, targetX, targetY)
      return
    }

    animatingDeviceIds.value[id] = true

    runNextFrame(() => {
      transientDevicePositions.value[id] = { x: targetX, y: targetY }
      const timer = window.setTimeout(() => {
        void settleDevicePosition(id, targetX, targetY)
      }, animationMs)
      snapAnimationTimers.set(id, timer)
    })
  }

  function finishDeviceDrag(id: string, x: number, y: number) {
    const activeGroupDrag = groupDragState.value
    if (activeGroupDrag?.leaderId === id) {
      const snappedPositions = snapDraggedPositions(
        activeGroupDrag.ids,
        activeGroupDrag.startPositions,
        id,
        { x, y },
        gridSize,
      )

      for (const [deviceId, position] of Object.entries(snappedPositions)) {
        animateDeviceToPosition(deviceId, position.x, position.y)
      }

      clearGroupDrag()
      return
    }

    animateDeviceToPosition(id, snapToGrid(x, gridSize), snapToGrid(y, gridSize))
  }

  function isDeviceAnimating(id: string) {
    return Boolean(animatingDeviceIds.value[id])
  }

  onUnmounted(() => {
    for (const timer of snapAnimationTimers.values()) {
      clearTimeout(timer)
    }
    snapAnimationTimers.clear()
  })

  return {
    animateDeviceToPosition,
    clearDeviceAnimation,
    clearGroupDrag,
    devicePosition,
    finishDeviceDrag,
    isDeviceAnimating,
    startGroupDrag,
    transientDevicePositions,
    updateDevicePosition,
  }
}
