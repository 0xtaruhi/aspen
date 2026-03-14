import { reactive } from 'vue'

import { resolveCanvasDeviceType } from '@/lib/canvas-devices'
import type { CanvasDeviceType } from '@/lib/hardware-client'

type PendingDrop = {
  nonce: number
  type: CanvasDeviceType
  clientX: number
  clientY: number
} | null

const state = reactive({
  active: false,
  type: null as CanvasDeviceType | null,
  clientX: 0,
  clientY: 0,
  pendingDrop: null as PendingDrop,
})

let previousCursor = ''
let previousUserSelect = ''

function restoreDocumentState() {
  if (typeof document === 'undefined') {
    return
  }

  document.body.style.cursor = previousCursor
  document.body.style.userSelect = previousUserSelect
}

function detachListeners() {
  if (typeof window === 'undefined') {
    return
  }

  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', cancelPaletteDrag)
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('blur', cancelPaletteDrag)
}

function handlePointerMove(event: PointerEvent) {
  if (!state.active) {
    return
  }

  state.clientX = event.clientX
  state.clientY = event.clientY
}

function handlePointerUp(event: PointerEvent) {
  if (!state.active || !state.type) {
    cancelPaletteDrag()
    return
  }

  state.pendingDrop = {
    nonce: Date.now(),
    type: state.type,
    clientX: event.clientX,
    clientY: event.clientY,
  }

  state.active = false
  state.type = null
  detachListeners()
  restoreDocumentState()
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    cancelPaletteDrag()
  }
}

export function beginPaletteDrag(rawType: string, event: PointerEvent) {
  const type = resolveCanvasDeviceType(rawType)
  if (!type || event.button !== 0) {
    return
  }

  event.preventDefault()

  state.active = true
  state.type = type
  state.clientX = event.clientX
  state.clientY = event.clientY
  state.pendingDrop = null

  if (typeof document !== 'undefined') {
    previousCursor = document.body.style.cursor
    previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = 'grabbing'
    document.body.style.userSelect = 'none'
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', cancelPaletteDrag)
    window.addEventListener('keydown', handleKeydown)
    window.addEventListener('blur', cancelPaletteDrag)
  }
}

export function cancelPaletteDrag() {
  state.active = false
  state.type = null
  detachListeners()
  restoreDocumentState()
}

export function consumePaletteDrop(nonce: number) {
  if (state.pendingDrop?.nonce === nonce) {
    state.pendingDrop = null
  }
}

export const paletteDragStore = {
  state,
}
