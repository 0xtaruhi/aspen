import type { Directive } from 'vue'

import { getCurrentWindow } from '@tauri-apps/api/window'

import { isMacDesktop } from '@/lib/window-frame'

const DRAG_BLOCK_SELECTOR = [
  '[data-tauri-drag-region="false"]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'a[href]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
].join(', ')

const WINDOW_CHROME_HANDLERS = Symbol('windowChromeHandlers')

type WindowChromeAction = 'startDragging' | 'toggleMaximize'
type WindowChromeBinding = boolean | undefined
type WindowChromeHandlers = {
  onDoubleClick: (event: MouseEvent) => void
  onPointerDown: (event: PointerEvent) => void
}
type WindowChromeElement = HTMLElement & {
  [WINDOW_CHROME_HANDLERS]?: WindowChromeHandlers
}

function isWindowChromeEnabled(value: WindowChromeBinding) {
  return isMacDesktop && value !== false
}

function isWindowChromeGestureTarget(event: MouseEvent | PointerEvent) {
  if (event.defaultPrevented || event.button !== 0) {
    return false
  }

  if ('isPrimary' in event && !event.isPrimary) {
    return false
  }

  const target = event.target
  return target instanceof Element && !target.closest(DRAG_BLOCK_SELECTOR)
}

async function runWindowChromeAction(action: WindowChromeAction, errorMessage: string) {
  try {
    await getCurrentWindow()[action]()
  } catch (error) {
    console.error(errorMessage, error)
  }
}

function bindWindowChrome(el: WindowChromeElement) {
  if (el[WINDOW_CHROME_HANDLERS]) {
    return
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!isWindowChromeGestureTarget(event) || event.detail > 1) {
      return
    }

    void runWindowChromeAction('startDragging', 'Failed to start window drag')
  }

  const onDoubleClick = (event: MouseEvent) => {
    if (!isWindowChromeGestureTarget(event) || event.detail !== 2) {
      return
    }

    void runWindowChromeAction('toggleMaximize', 'Failed to toggle window maximize')
  }

  el.addEventListener('pointerdown', onPointerDown)
  el.addEventListener('dblclick', onDoubleClick)
  el[WINDOW_CHROME_HANDLERS] = { onDoubleClick, onPointerDown }
}

function unbindWindowChrome(el: WindowChromeElement) {
  const handlers = el[WINDOW_CHROME_HANDLERS]
  if (!handlers) {
    return
  }

  el.removeEventListener('pointerdown', handlers.onPointerDown)
  el.removeEventListener('dblclick', handlers.onDoubleClick)
  delete el[WINDOW_CHROME_HANDLERS]
}

export const vWindowChrome: Directive<HTMLElement, WindowChromeBinding> = {
  mounted(el, binding) {
    if (isWindowChromeEnabled(binding.value)) {
      bindWindowChrome(el as WindowChromeElement)
    }
  },
  updated(el, binding) {
    const chromeEl = el as WindowChromeElement

    if (isWindowChromeEnabled(binding.value)) {
      bindWindowChrome(chromeEl)
      return
    }

    unbindWindowChrome(chromeEl)
  },
  beforeUnmount(el) {
    unbindWindowChrome(el as WindowChromeElement)
  },
}
