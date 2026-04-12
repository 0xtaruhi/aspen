const EDITABLE_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '.allow-text-select',
  '.monaco-editor',
  '[data-allow-native-context-menu]',
].join(',')

const APP_CONTEXT_MENU_SELECTOR = [
  '[data-slot="context-menu-trigger"]',
  '[data-slot="context-menu-content"]',
].join(',')

function closestElement(target: EventTarget | null): Element | null {
  return target instanceof Element ? target : null
}

function shouldUseNativeContextMenu(event: MouseEvent) {
  const target = closestElement(event.target)
  if (!target) {
    return false
  }

  return Boolean(target.closest(EDITABLE_SELECTOR) || target.closest(APP_CONTEXT_MENU_SELECTOR))
}

export function installNativeContextMenuGuard() {
  const handleContextMenu = (event: MouseEvent) => {
    if (shouldUseNativeContextMenu(event)) {
      return
    }

    event.preventDefault()
  }

  window.addEventListener('contextmenu', handleContextMenu, { capture: true })

  return () => {
    window.removeEventListener('contextmenu', handleContextMenu, { capture: true })
  }
}
