import type * as Monaco from 'monaco-editor/editor/editor.api'

import { describe, expect, it, vi } from 'vitest'

import { registerHdlLspFeatures } from '@/lib/hdl-lsp-features'

const range = {
  start: { line: 1, character: 2 },
  end: { line: 1, character: 5 },
}

function createMonaco() {
  const providers = {
    completion: [] as Monaco.languages.CompletionItemProvider[],
    definition: [] as Monaco.languages.DefinitionProvider[],
    hover: [] as Monaco.languages.HoverProvider[],
    reference: [] as Monaco.languages.ReferenceProvider[],
    rename: [] as Monaco.languages.RenameProvider[],
  }
  const register =
    <T>(target: T[]) =>
    (_language: string, provider: T) => {
      target.push(provider)
      return { dispose() {} }
    }
  const kinds = {
    Method: 0,
    Function: 1,
    Constructor: 2,
    Field: 3,
    Variable: 4,
    Class: 5,
    Struct: 6,
    Interface: 7,
    Module: 8,
    Property: 9,
    Event: 10,
    Operator: 11,
    Unit: 12,
    Value: 13,
    Constant: 14,
    Enum: 15,
    EnumMember: 16,
    Keyword: 17,
    Text: 18,
    Color: 19,
    File: 20,
    Reference: 21,
    Folder: 23,
    TypeParameter: 24,
    Snippet: 28,
  }
  const monaco = {
    Uri: { parse: (value: string) => ({ toString: () => value }) },
    languages: {
      CompletionItemKind: kinds,
      CompletionItemTag: { Deprecated: 1 },
      CompletionItemInsertTextRule: { InsertAsSnippet: 4 },
      registerCompletionItemProvider: register(providers.completion),
      registerDefinitionProvider: register(providers.definition),
      registerHoverProvider: register(providers.hover),
      registerReferenceProvider: register(providers.reference),
      registerRenameProvider: register(providers.rename),
    },
  } as unknown as typeof Monaco

  return { monaco, providers }
}

describe('HDL LSP Monaco features', () => {
  it('maps completion, hover, navigation, references, and rename responses', async () => {
    const { monaco, providers } = createMonaco()
    const request = vi.fn(async (_model, method: string) => {
      switch (method) {
        case 'textDocument/completion':
          return {
            isIncomplete: true,
            items: [
              {
                label: 'clock_enable',
                kind: 6,
                detail: 'logic',
                insertText: 'clock_enable',
              },
            ],
          }
        case 'completionItem/resolve':
          return { label: 'clock_enable', kind: 6, detail: 'resolved logic' }
        case 'textDocument/hover':
          return { contents: { kind: 'markdown', value: '**logic**' }, range }
        case 'textDocument/definition':
          return { uri: 'file:///workspace/defs.sv', range }
        case 'textDocument/references':
          return [
            { uri: 'file:///workspace/top.sv', range },
            { uri: 'file:///workspace/defs.sv', range },
          ]
        case 'textDocument/rename':
          return {
            changes: {
              'file:///workspace/top.sv': [{ range, newText: 'renamed_clock' }],
              'file:///workspace/defs.sv': [{ range, newText: 'renamed_clock' }],
            },
          }
        default:
          throw new Error(`unexpected method: ${method}`)
      }
    })
    registerHdlLspFeatures(monaco, request)

    expect(providers.completion).toHaveLength(2)
    expect(providers.definition).toHaveLength(2)
    expect(providers.reference).toHaveLength(2)
    expect(providers.rename).toHaveLength(2)

    const model = {
      uri: { toString: () => 'file:///workspace/top.sv' },
      getWordUntilPosition: () => ({ startColumn: 3, endColumn: 6 }),
    } as unknown as Monaco.editor.ITextModel
    const position = { lineNumber: 2, column: 5 } as Monaco.Position
    const token = {} as Monaco.CancellationToken
    const completion = await providers.completion[0]?.provideCompletionItems(
      model,
      position,
      { triggerKind: 0 },
      token,
    )
    expect(completion).toMatchObject({
      incomplete: true,
      suggestions: [
        {
          label: 'clock_enable',
          kind: monaco.languages.CompletionItemKind.Variable,
          range: {
            startLineNumber: 2,
            startColumn: 3,
            endLineNumber: 2,
            endColumn: 6,
          },
        },
      ],
    })
    const suggestion = completion?.suggestions[0]
    expect(suggestion).toBeDefined()
    await expect(
      providers.completion[0]?.resolveCompletionItem?.(suggestion!, token),
    ).resolves.toMatchObject({ detail: 'resolved logic' })

    await expect(providers.hover[0]?.provideHover(model, position, token)).resolves.toMatchObject({
      contents: [{ value: '**logic**' }],
    })
    await expect(
      providers.definition[0]?.provideDefinition(model, position, token),
    ).resolves.toMatchObject([{ uri: { toString: expect.any(Function) } }])
    await expect(
      providers.reference[0]?.provideReferences(
        model,
        position,
        { includeDeclaration: true },
        token,
      ),
    ).resolves.toHaveLength(2)
    await expect(
      providers.rename[0]?.provideRenameEdits(model, position, 'renamed_clock', token),
    ).resolves.toMatchObject({ edits: [{ textEdit: { text: 'renamed_clock' } }, {}] })

    expect(request).toHaveBeenCalledWith(
      model,
      'textDocument/definition',
      expect.objectContaining({ position: { line: 1, character: 4 } }),
    )
  })
})
