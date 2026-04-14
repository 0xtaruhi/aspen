import { describe, expect, it } from 'vitest'

import { PROJECT_IMPORT_SOURCE_FILE_EXTENSIONS } from './project-io'

describe('project import source filters', () => {
  it('allows importing .mem files anywhere that uses the shared source-file filter', () => {
    expect(PROJECT_IMPORT_SOURCE_FILE_EXTENSIONS).toContain('mem')
  })
})
