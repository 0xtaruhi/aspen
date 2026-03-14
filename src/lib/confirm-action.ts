import { confirm as confirmDialog } from '@tauri-apps/plugin-dialog'

type ConfirmActionOptions = {
  title?: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isTauriDialogUnavailable(error: unknown): boolean {
  const message = getErrorMessage(error)

  return (
    message.includes('__TAURI_INTERNALS__') ||
    message.includes('window.__TAURI_INTERNALS__') ||
    message.includes('plugin') ||
    message.includes("Cannot read properties of undefined (reading 'invoke')") ||
    message.includes("Cannot read properties of undefined (reading 'transformCallback')")
  )
}

export async function confirmAction(
  message: string,
  options: ConfirmActionOptions = {},
): Promise<boolean> {
  try {
    return await confirmDialog(message, {
      title: options.title ?? 'Confirm',
      kind: 'warning',
    })
  } catch (error) {
    if (isTauriDialogUnavailable(error)) {
      if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
        return window.confirm(message)
      }

      return false
    }

    throw error
  }
}
