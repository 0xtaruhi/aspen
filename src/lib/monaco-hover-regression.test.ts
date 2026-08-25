import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

const editorSource = readFileSync(
  path.resolve(import.meta.dirname, '../components/editor/CodeEditor.vue'),
  'utf8',
)

describe('Monaco hover regression', () => {
  it('loads the Monaco UI contributions used by HDL language providers', () => {
    for (const contribution of [
      'editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition',
      'editor/contrib/hover/browser/hoverContribution',
      'editor/contrib/rename/browser/rename',
      'editor/contrib/suggest/browser/suggestController',
      'editor/standalone/browser/referenceSearch/standaloneReferenceSearch',
    ]) {
      expect(editorSource).toContain(`import 'monaco-editor/${contribution}'`)
    }
  })

  it('keeps hover widgets correctly positioned outside clipped editor containers', () => {
    expect(editorSource).toContain('fixedOverflowWidgets: true')
    expect(editorSource).toContain('overflowWidgetsDomNode: overflowWidgetsHost')
    expect(editorSource).toContain('overflowWidgetsHost?.remove()')
  })
})
