export function getProjectPersistenceErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function isProjectPersistenceTauriUnavailable(err: unknown) {
  const message = getProjectPersistenceErrorMessage(err)
  return (
    message.includes('__TAURI_INTERNALS__') ||
    message.includes('window.__TAURI_INTERNALS__') ||
    /tauri.*plugin/i.test(message) ||
    message.includes("Cannot read properties of undefined (reading 'invoke')") ||
    message.includes("Cannot read properties of undefined (reading 'transformCallback')")
  )
}

export function isMissingProjectPersistencePath(err: unknown) {
  const message = getProjectPersistenceErrorMessage(err).toLowerCase()
  return (
    message.includes('enoent') ||
    message.includes('no such file or directory') ||
    message.includes('no such file') ||
    message.includes('cannot find the path')
  )
}
