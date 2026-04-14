import type { MessageKey } from '@/lib/i18n'

import { translate } from '@/lib/i18n'
import {
  getProjectPersistenceErrorMessage,
  isMissingProjectPersistencePath,
  isProjectPersistenceTauriUnavailable,
} from './project-persistence-errors'

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
  return getProjectPersistenceErrorMessage(err)
}

export function isProjectIoTauriUnavailable(err: unknown): boolean {
  return isProjectPersistenceTauriUnavailable(err)
}

export function shouldForgetRecentProject(err: unknown) {
  return isMissingProjectPersistencePath(err)
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
