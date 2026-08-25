import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const editorSource = readFileSync(
  path.resolve(import.meta.dirname, '../components/editor/CodeEditor.vue'),
  'utf8',
)

describe('Monaco hover regression', () => {
  it('loads the hover contribution used by registered HDL hover providers', () => {
    expect(editorSource).toContain(
      "import 'monaco-editor/editor/contrib/hover/browser/hoverContribution'",
    )
  })
})
