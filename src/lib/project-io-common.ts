import type { MessageKey } from '@/lib/i18n'

import { translate } from '@/lib/i18n'

type ProjectIoMessageParams = Record<string, string | number>

export type ProjectIoMessageDescriptor = {
  key: MessageKey
  params?: ProjectIoMessageParams
}

export type ProjectIoServiceResult<T> =
  | {
      kind: 'success'
      value: T
      message?: ProjectIoMessageDescriptor
    }
  | {
      kind: 'failure'
      reason: 'validation' | 'error'
      message: ProjectIoMessageDescriptor
      error?: unknown
    }

export function getProjectIoErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function isProjectIoTauriUnavailable(err: unknown): boolean {
  const message = getProjectIoErrorMessage(err)
  return (
    message.includes('__TAURI_INTERNALS__') ||
    message.includes('window.__TAURI_INTERNALS__') ||
    message.includes('plugin')
  )
}

export function shouldForgetRecentProject(err: unknown) {
  const message = getProjectIoErrorMessage(err).toLowerCase()
  return (
    message.includes('no such file') ||
    message.includes('not found') ||
    message.includes('cannot find the path')
  )
}

export function resolveProjectIoMessage(message: ProjectIoMessageDescriptor) {
  return translate(message.key, message.params)
}

export function showProjectIoMessage(message?: ProjectIoMessageDescriptor | null) {
  if (!message || typeof window === 'undefined') {
    return
  }

  window.alert(resolveProjectIoMessage(message))
}
