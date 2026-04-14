import { describe, expect, it } from 'vitest'

import {
  isMissingProjectPersistencePath,
  isProjectPersistenceTauriUnavailable,
} from './project-persistence-errors'

describe('project persistence errors', () => {
  it('only treats tauri bootstrap failures as tauri-unavailable errors', () => {
    expect(
      isProjectPersistenceTauriUnavailable(
        new Error("Cannot read properties of undefined (reading 'invoke')"),
      ),
    ).toBe(true)
    expect(
      isProjectPersistenceTauriUnavailable(new Error('plugin returned validation failed')),
    ).toBe(false)
  })

  it('only treats filesystem missing-path errors as missing-path failures', () => {
    expect(isMissingProjectPersistencePath(new Error('ENOENT: no such file or directory'))).toBe(
      true,
    )
    expect(isMissingProjectPersistencePath(new Error('top module not found in design'))).toBe(false)
  })
})
