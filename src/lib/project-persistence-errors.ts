export function getProjectPersistenceErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function isProjectPersistenceTauriUnavailable(err: unknown) {
  const message = getProjectPersistenceErrorMessage(err)
  return (
    message.includes('__TAURI_INTERNALS__') ||
    message.includes('window.__TAURI_INTERNALS__') ||
    message.includes('plugin')
  )
}

export function isMissingProjectPersistencePath(err: unknown) {
  const message = getProjectPersistenceErrorMessage(err).toLowerCase()
  return (
    message.includes('no such file') ||
    message.includes('not found') ||
    message.includes('cannot find the path')
  )
}
