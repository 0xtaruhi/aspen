import type * as Monaco from 'monaco-editor/editor/editor.api'

type LspPosition = { line: number; character: number }
type LspRange = { start: LspPosition; end: LspPosition }
type LspTextEdit = { range: LspRange; newText: string }
type LspLocation = { uri: string; range: LspRange }
type LspLocationLink = {
  targetUri: string
  targetRange: LspRange
  targetSelectionRange: LspRange
  originSelectionRange?: LspRange
}
type LspCompletionItem = {
  label: string
  kind?: number
  tags?: number[]
  detail?: string
  documentation?: string | { kind: 'markdown' | 'plaintext'; value: string }
  sortText?: string
  filterText?: string
  preselect?: boolean
  insertText?: string
  insertTextFormat?: number
  textEdit?: LspTextEdit | { insert: LspRange; replace: LspRange; newText: string }
  additionalTextEdits?: LspTextEdit[]
  commitCharacters?: string[]
  data?: unknown
}
type LspCompletionList = {
  isIncomplete?: boolean
  items: LspCompletionItem[]
  itemDefaults?: {
    editRange?: LspRange | { insert: LspRange; replace: LspRange }
    insertTextFormat?: number
  }
}
type LspWorkspaceEdit = {
  changes?: Record<string, LspTextEdit[]>
  documentChanges?: Array<{
    textDocument?: { uri?: string }
    edits?: LspTextEdit[]
  }>
}
type LspHover = {
  contents?:
    | string
    | { language: string; value: string }
    | { kind: 'markdown' | 'plaintext'; value: string }
    | Array<
        | string
        | { language: string; value: string }
        | { kind: 'markdown' | 'plaintext'; value: string }
      >
  range?: LspRange
}

export type HdlLspFeatureRequest = (
  model: Monaco.editor.ITextModel,
  method: string,
  params: unknown,
) => Promise<unknown>

const LANGUAGES = ['verilog', 'systemverilog'] as const
const COMPLETION_TRIGGERS = ['`', '#', '.', '(', ':', '[', '$']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function toLspPosition(position: Monaco.Position): LspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 }
}

function toMonacoRange(range: LspRange): Monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  }
}

function textDocumentPosition(model: Monaco.editor.ITextModel, position: Monaco.Position) {
  return {
    textDocument: { uri: model.uri.toString() },
    position: toLspPosition(position),
  }
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|>]/g, '\\$&')
}

function markdown(value: unknown): Monaco.IMarkdownString | string | undefined {
  if (typeof value === 'string') return value
  if (!isRecord(value) || typeof value.value !== 'string') return undefined
  return value.kind === 'markdown' ? { value: value.value } : value.value
}

function hoverContents(contents: LspHover['contents']): Monaco.IMarkdownString[] {
  if (!contents) return []

  return (Array.isArray(contents) ? contents : [contents]).flatMap((entry) => {
    if (typeof entry === 'string') return [{ value: escapeMarkdown(entry) }]
    if ('language' in entry) {
      return [{ value: `\`\`\`${entry.language}\n${entry.value}\n\`\`\`` }]
    }
    return [{ value: entry.kind === 'markdown' ? entry.value : escapeMarkdown(entry.value) }]
  })
}

function completionKind(monaco: typeof Monaco, kind?: number): Monaco.languages.CompletionItemKind {
  const kinds = monaco.languages.CompletionItemKind
  return (
    [
      kinds.Text,
      kinds.Method,
      kinds.Function,
      kinds.Constructor,
      kinds.Field,
      kinds.Variable,
      kinds.Class,
      kinds.Interface,
      kinds.Module,
      kinds.Property,
      kinds.Unit,
      kinds.Value,
      kinds.Enum,
      kinds.Keyword,
      kinds.Snippet,
      kinds.Color,
      kinds.File,
      kinds.Reference,
      kinds.Folder,
      kinds.EnumMember,
      kinds.Constant,
      kinds.Struct,
      kinds.Event,
      kinds.Operator,
      kinds.TypeParameter,
    ][Math.max(0, (kind ?? 1) - 1)] ?? kinds.Text
  )
}

function completionRange(
  editRange: LspRange | { insert: LspRange; replace: LspRange } | undefined,
  fallback: Monaco.IRange,
): Monaco.IRange | Monaco.languages.CompletionItemRanges {
  if (!isRecord(editRange)) return fallback
  if ('start' in editRange) return toMonacoRange(editRange as LspRange)
  if (isRecord(editRange.insert) && isRecord(editRange.replace)) {
    return {
      insert: toMonacoRange(editRange.insert as LspRange),
      replace: toMonacoRange(editRange.replace as LspRange),
    }
  }
  return fallback
}

function completionItem(
  monaco: typeof Monaco,
  item: LspCompletionItem,
  fallbackRange: Monaco.IRange,
  defaults?: LspCompletionList['itemDefaults'],
): Monaco.languages.CompletionItem {
  const textEdit = item.textEdit
  const range = textEdit
    ? 'range' in textEdit
      ? toMonacoRange(textEdit.range)
      : { insert: toMonacoRange(textEdit.insert), replace: toMonacoRange(textEdit.replace) }
    : completionRange(defaults?.editRange, fallbackRange)
  const insertText = textEdit?.newText ?? item.insertText ?? item.label
  const insertTextFormat = item.insertTextFormat ?? defaults?.insertTextFormat

  return {
    label: item.label,
    kind: completionKind(monaco, item.kind),
    tags: item.tags?.includes(1) ? [monaco.languages.CompletionItemTag.Deprecated] : undefined,
    detail: item.detail,
    documentation: markdown(item.documentation),
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    insertText,
    insertTextRules:
      insertTextFormat === 2
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
    range,
    additionalTextEdits: item.additionalTextEdits?.map((edit) => ({
      range: toMonacoRange(edit.range),
      text: edit.newText,
    })),
    commitCharacters: item.commitCharacters,
  }
}

function locations(monaco: typeof Monaco, response: unknown): Monaco.languages.Definition {
  const values = Array.isArray(response) ? response : response ? [response] : []
  return values.flatMap((value): Monaco.languages.LocationLink[] => {
    if (!isRecord(value)) return []
    if (typeof value.targetUri === 'string' && isRecord(value.targetRange)) {
      const link = value as unknown as LspLocationLink
      return [
        {
          uri: monaco.Uri.parse(link.targetUri),
          range: toMonacoRange(link.targetRange),
          targetSelectionRange: toMonacoRange(link.targetSelectionRange),
          originSelectionRange: link.originSelectionRange
            ? toMonacoRange(link.originSelectionRange)
            : undefined,
        },
      ]
    }
    if (typeof value.uri !== 'string' || !isRecord(value.range)) return []
    const location = value as unknown as LspLocation
    return [{ uri: monaco.Uri.parse(location.uri), range: toMonacoRange(location.range) }]
  })
}

function workspaceEdit(monaco: typeof Monaco, response: unknown): Monaco.languages.WorkspaceEdit {
  if (!isRecord(response)) return { edits: [] }
  const edit = response as LspWorkspaceEdit
  const changes = Object.entries(edit.changes ?? {}).flatMap(([uri, edits]) =>
    edits.map((item) => ({
      resource: monaco.Uri.parse(uri),
      textEdit: { range: toMonacoRange(item.range), text: item.newText },
      versionId: undefined,
    })),
  )
  const documentChanges = (edit.documentChanges ?? []).flatMap((change) => {
    const uri = change.textDocument?.uri
    if (!uri) return []
    return (change.edits ?? []).map((item) => ({
      resource: monaco.Uri.parse(uri),
      textEdit: { range: toMonacoRange(item.range), text: item.newText },
      versionId: undefined,
    }))
  })
  return { edits: [...changes, ...documentChanges] }
}

export function registerHdlLspFeatures(monaco: typeof Monaco, request: HdlLspFeatureRequest) {
  const rawCompletions = new WeakMap<
    Monaco.languages.CompletionItem,
    { model: Monaco.editor.ITextModel; item: LspCompletionItem; range: Monaco.IRange }
  >()

  for (const language of LANGUAGES) {
    monaco.languages.registerHoverProvider(language, {
      async provideHover(model, position) {
        const response = (await request(
          model,
          'textDocument/hover',
          textDocumentPosition(model, position),
        ).catch(() => null)) as LspHover | null
        if (!response) return null
        const contents = hoverContents(response.contents)
        return contents.length
          ? { contents, range: response.range ? toMonacoRange(response.range) : undefined }
          : null
      },
    })

    monaco.languages.registerCompletionItemProvider(language, {
      triggerCharacters: COMPLETION_TRIGGERS,
      async provideCompletionItems(model, position, context) {
        const response = await request(model, 'textDocument/completion', {
          ...textDocumentPosition(model, position),
          context: {
            triggerKind: context.triggerKind + 1,
            triggerCharacter: context.triggerCharacter,
          },
        }).catch(() => null)
        const list: LspCompletionList = Array.isArray(response)
          ? { items: response as LspCompletionItem[] }
          : isRecord(response) && Array.isArray(response.items)
            ? (response as unknown as LspCompletionList)
            : { items: [] }
        const word = model.getWordUntilPosition(position)
        const range = {
          startLineNumber: position.lineNumber,
          startColumn: word.startColumn,
          endLineNumber: position.lineNumber,
          endColumn: word.endColumn,
        }
        const suggestions = list.items.map((item) => {
          const suggestion = completionItem(monaco, item, range, list.itemDefaults)
          rawCompletions.set(suggestion, { model, item, range })
          return suggestion
        })
        return { suggestions, incomplete: list.isIncomplete }
      },
      async resolveCompletionItem(item) {
        const source = rawCompletions.get(item)
        if (!source) return item
        const resolved = await request(source.model, 'completionItem/resolve', source.item).catch(
          () => null,
        )
        if (!isRecord(resolved) || typeof resolved.label !== 'string') return item
        Object.assign(
          item,
          completionItem(monaco, resolved as unknown as LspCompletionItem, source.range),
        )
        return item
      },
    })

    monaco.languages.registerDefinitionProvider(language, {
      async provideDefinition(model, position) {
        return locations(
          monaco,
          await request(model, 'textDocument/definition', textDocumentPosition(model, position)),
        )
      },
    })

    monaco.languages.registerReferenceProvider(language, {
      async provideReferences(model, position, context) {
        return locations(
          monaco,
          await request(model, 'textDocument/references', {
            ...textDocumentPosition(model, position),
            context: { includeDeclaration: context.includeDeclaration },
          }),
        ) as Monaco.languages.Location[]
      },
    })

    monaco.languages.registerRenameProvider(language, {
      async provideRenameEdits(model, position, newName) {
        return workspaceEdit(
          monaco,
          await request(model, 'textDocument/rename', {
            ...textDocumentPosition(model, position),
            newName,
          }),
        )
      },
    })
  }
}
