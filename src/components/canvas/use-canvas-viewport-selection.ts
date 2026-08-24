import type { ComponentPublicInstance, ComputedRef, CSSProperties } from 'vue'
import type { CanvasDeviceSnapshot } from '@/lib/hardware-client'
import type { CanvasPoint } from '@/lib/canvas-selection'
import type { CanvasDeviceShellSize } from '@/lib/canvas-devices'

import { computed, onUnmounted, ref } from 'vue'
import {
  clampClientPointToCanvas,
  clientToCanvasPoint,
  collectIntersectingBoundsIds,
  hasCanvasPointerMoved,
  isClientPointInsideCanvas,
  normalizeCanvasRect,
  zoomCanvasScale,
} from '@/lib/canvas-selection'

export type CanvasInteractionMode = 'select' | 'pan'

type DragSelectionState = {
  append: boolean
  baseSelectedIds: string[]
  currentClientX: number
  currentClientY: number
  startClientX: number
  startClientY: number
}

type CanvasViewportSelectionOptions = {
  devices: ComputedRef<CanvasDeviceSnapshot[]>
  selectedDeviceIds: ComputedRef<string[]>
  blockedTopInset: ComputedRef<number>
  interactionMode: ComputedRef<CanvasInteractionMode>
  normalizeSelectedIds: (ids: readonly string[]) => string[]
  setSelectedDevices: (ids: readonly string[], primaryId?: string | null) => void
  devicePosition: (device: CanvasDeviceSnapshot) => CanvasPoint
  shellSize: (device: CanvasDeviceSnapshot) => CanvasDeviceShellSize
}

const MARQUEE_THRESHOLD_PX = 4

export function useCanvasViewportSelection(options: CanvasViewportSelectionOptions) {
  const canvasRef = ref<HTMLElement | null>(null)
  const scale = ref(1)
  const offset = ref({ x: 0, y: 0 })
  const isDraggingCanvas = ref(false)
  const lastMousePos = ref({ x: 0, y: 0 })
  const selectionState = ref<DragSelectionState | null>(null)

  function setCanvasElement(element: Element | ComponentPublicInstance | null) {
    canvasRef.value = element instanceof HTMLElement ? element : null
  }

  function handleWheel(event: WheelEvent) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault()
      scale.value = zoomCanvasScale(scale.value, event.deltaY)
      return
    }

    offset.value.x -= event.deltaX
    offset.value.y -= event.deltaY
  }

  function startPan(event: MouseEvent) {
    isDraggingCanvas.value = true
    lastMousePos.value = { x: event.clientX, y: event.clientY }
    addWindowMouseListeners()
  }

  function startSelection(event: MouseEvent) {
    const append = event.shiftKey || event.metaKey
    selectionState.value = {
      append,
      baseSelectedIds: append ? [...options.selectedDeviceIds.value] : [],
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      startClientX: event.clientX,
      startClientY: event.clientY,
    }
    addWindowMouseListeners()
  }

  function handleCanvasMouseDown(event: MouseEvent) {
    if (event.button === 1 || (event.button === 0 && event.altKey)) {
      event.preventDefault()
      startPan(event)
      return
    }

    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    if (options.interactionMode.value === 'pan') {
      startPan(event)
    } else {
      startSelection(event)
    }
  }

  function handleWindowMouseMove(event: MouseEvent) {
    if (isDraggingCanvas.value) {
      offset.value.x += event.clientX - lastMousePos.value.x
      offset.value.y += event.clientY - lastMousePos.value.y
      lastMousePos.value = { x: event.clientX, y: event.clientY }
      return
    }

    if (selectionState.value) {
      selectionState.value = {
        ...selectionState.value,
        currentClientX: event.clientX,
        currentClientY: event.clientY,
      }
    }
  }

  function addWindowMouseListeners() {
    window.addEventListener('mousemove', handleWindowMouseMove)
    window.addEventListener('mouseup', handleWindowMouseUp)
  }

  function removeWindowMouseListeners() {
    window.removeEventListener('mousemove', handleWindowMouseMove)
    window.removeEventListener('mouseup', handleWindowMouseUp)
  }

  function resolveCanvasPlacement(clientX: number, clientY: number) {
    if (!canvasRef.value) {
      return null
    }

    const rect = canvasRef.value.getBoundingClientRect()
    if (!isClientPointInsideCanvas(rect, clientX, clientY, options.blockedTopInset.value)) {
      return null
    }

    return clientToCanvasPoint(rect, { scale: scale.value, offset: offset.value }, clientX, clientY)
  }

  function resolveCanvasPoint(clientX: number, clientY: number) {
    if (!canvasRef.value) {
      return null
    }

    return clientToCanvasPoint(
      canvasRef.value.getBoundingClientRect(),
      { scale: scale.value, offset: offset.value },
      clientX,
      clientY,
    )
  }

  function selectionMovedEnough(state: DragSelectionState) {
    return hasCanvasPointerMoved(
      { x: state.startClientX, y: state.startClientY },
      { x: state.currentClientX, y: state.currentClientY },
      MARQUEE_THRESHOLD_PX,
    )
  }

  function collectSelectionIds(state: DragSelectionState) {
    const start = resolveCanvasPoint(state.startClientX, state.startClientY)
    const end = resolveCanvasPoint(state.currentClientX, state.currentClientY)
    if (!start || !end) {
      return state.append ? [...state.baseSelectedIds] : []
    }

    const ids = collectIntersectingBoundsIds(
      normalizeCanvasRect(start, end),
      options.devices.value.map((device) => {
        const position = options.devicePosition(device)
        const size = options.shellSize(device)
        return { id: device.id, x: position.x, y: position.y, ...size }
      }),
    )

    return state.append ? [...state.baseSelectedIds, ...ids] : ids
  }

  const selectionOverlayStyle = computed<CSSProperties | null>(() => {
    if (!selectionState.value || !canvasRef.value) {
      return null
    }

    const rect = canvasRef.value.getBoundingClientRect()
    const start = clampClientPointToCanvas(
      rect,
      selectionState.value.startClientX,
      selectionState.value.startClientY,
    )
    const end = clampClientPointToCanvas(
      rect,
      selectionState.value.currentClientX,
      selectionState.value.currentClientY,
    )
    const selectionRect = normalizeCanvasRect(start, end)
    return {
      left: `${selectionRect.x}px`,
      top: `${selectionRect.y}px`,
      width: `${selectionRect.width}px`,
      height: `${selectionRect.height}px`,
    }
  })

  const displayedSelectedDeviceIdSet = computed(() => {
    if (!selectionState.value || !selectionMovedEnough(selectionState.value)) {
      return new Set(options.selectedDeviceIds.value)
    }

    return new Set(options.normalizeSelectedIds(collectSelectionIds(selectionState.value)))
  })

  function finishSelection() {
    const currentSelection = selectionState.value
    selectionState.value = null
    if (!currentSelection) {
      return
    }

    if (!selectionMovedEnough(currentSelection)) {
      if (!currentSelection.append) {
        options.setSelectedDevices([], null)
      }
      return
    }

    const nextIds = options.normalizeSelectedIds(collectSelectionIds(currentSelection))
    options.setSelectedDevices(nextIds, nextIds.length === 1 ? (nextIds[0] ?? null) : null)
  }

  function handleWindowMouseUp() {
    isDraggingCanvas.value = false
    if (selectionState.value) {
      finishSelection()
    }
    removeWindowMouseListeners()
  }

  onUnmounted(removeWindowMouseListeners)

  return {
    displayedSelectedDeviceIdSet,
    handleCanvasMouseDown,
    handleWheel,
    isDraggingCanvas,
    offset,
    resolveCanvasPlacement,
    scale,
    selectionOverlayStyle,
    setCanvasElement,
  }
}
