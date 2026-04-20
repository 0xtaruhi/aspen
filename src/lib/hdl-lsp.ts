import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'

import {
  buildEditorFileUri,
  normalizeEditorLanguage,
  normalizeEditorPath,
  type EditorLanguage,
} from '@/lib/editor-language'

type HdlProjectSourceFile = {
  path: string
  content: string
}

type HdlLspStartResponse = {
  session_id: string
  root_uri: string
  available: boolean
}

type HdlLspEventPayload = {
  session_id: string
  message: unknown
}

type JsonRpcId = number

type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

type JsonRpcSuccessResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
}

type JsonRpcErrorResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcSuccessResponse
  | JsonRpcErrorResponse

type LspPosition = {
  line: number
  character: number
}

type LspRange = {
  start: LspPosition
  end: LspPosition
}

type LspDiagnostic = {
  range: LspRange
  severity?: number
  code?: string | number
  source?: string
  message: string
  tags?: number[]
}

type PublishDiagnosticsParams = {
  uri: string
  diagnostics: LspDiagnostic[]
}

type HoverResponse = {
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

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

type HdlLspSessionConfig = {
  sessionId: string
  rootUri?: string | null
  filesKey?: string
  files: HdlProjectSourceFile[]
}

type HdlTextModelSpec = {
  path: string
  content: string
  language: EditorLanguage
}

type LspMessageListener = (message: unknown) => void

type OpenDocumentBinding = {
  model: monaco.editor.ITextModel
  changeDisposable: monaco.IDisposable
  disposeDisposable: monaco.IDisposable
}

class TauriMessageTransport {
  private readonly sessionId: string
  private listener?: LspMessageListener
  private readonly queuedMessages: unknown[] = []
  private disposed = false
  private readonly unlistenPromise: Promise<UnlistenFn>

  constructor(sessionId: string) {
    this.sessionId = sessionId
    this.unlistenPromise = listen<HdlLspEventPayload>('hdl:lsp-message', (event) => {
      if (event.payload.session_id !== this.sessionId || this.disposed) {
        return
      }

      this.dispatchReceivedMessage(event.payload.message)
    })
  }

  setListener(listener?: LspMessageListener) {
    this.listener = listener
    if (!listener) {
      return
    }

    while (this.queuedMessages.length > 0 && this.listener) {
      const message = this.queuedMessages.shift()
      if (message !== undefined) {
        this.listener(message)
      }
    }
  }

  async send(message: unknown) {
    await invoke('hdl_lsp_forward', {
      request: {
        sessionId: this.sessionId,
        message,
      },
    })
  }

  async dispose() {
    if (this.disposed) {
      return
    }

    this.disposed = true

    const unlisten = await this.unlistenPromise
    unlisten()
  }

  private dispatchReceivedMessage(message: unknown) {
    if (this.listener) {
      this.listener(message)
      return
    }

    this.queuedMessages.push(message)
  }
}

type HdlLspRuntime = {
  sessionId: string
  rootUri: string
  filesKey: string
  transport: TauriMessageTransport
  nextRequestId: number
  pendingRequests: Map<JsonRpcId, PendingRequest>
  diagnosticsByUri: Map<string, monaco.editor.IMarkerData[]>
  openDocuments: Map<string, OpenDocumentBinding>
}

let runtime: HdlLspRuntime | null = null
let pendingSessionId: string | null = null
let pendingSessionPromise: Promise<HdlLspStartResponse | null> | null = null
let featuresRegistered = false

const HDL_LSP_MARKER_OWNER = 'slang-server'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isHdlLanguage(language: EditorLanguage): boolean {
  return language === 'verilog' || language === 'systemverilog'
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|>]/g, '\\$&')
}

function toLspPosition(position: monaco.Position): LspPosition {
  return {
    line: position.lineNumber - 1,
    character: position.column - 1,
  }
}

function toMonacoRange(range?: LspRange): monaco.IRange | undefined {
  if (!range) {
    return undefined
  }

  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  }
}

function toMonacoSeverity(severity?: number) {
  switch (severity) {
    case 1:
      return monaco.MarkerSeverity.Error
    case 2:
      return monaco.MarkerSeverity.Warning
    case 3:
      return monaco.MarkerSeverity.Info
    case 4:
      return monaco.MarkerSeverity.Hint
    default:
      return monaco.MarkerSeverity.Info
  }
}

function toMonacoTags(tags?: number[]): monaco.MarkerTag[] | undefined {
  if (!tags || tags.length === 0) {
    return undefined
  }

  const markerTags: monaco.MarkerTag[] = []

  if (tags.includes(1)) {
    markerTags.push(monaco.MarkerTag.Unnecessary)
  }
  if (tags.includes(2)) {
    markerTags.push(monaco.MarkerTag.Deprecated)
  }

  return markerTags.length > 0 ? markerTags : undefined
}

function toMonacoMarkers(diagnostics: LspDiagnostic[]): monaco.editor.IMarkerData[] {
  return diagnostics.map((diagnostic) => {
    const range = toMonacoRange(diagnostic.range)
    const code = typeof diagnostic.code === 'number' ? String(diagnostic.code) : diagnostic.code

    return {
      severity: toMonacoSeverity(diagnostic.severity),
      message: diagnostic.message,
      source: diagnostic.source ?? 'slang-server',
      code,
      tags: toMonacoTags(diagnostic.tags),
      startLineNumber: range?.startLineNumber ?? 1,
      startColumn: range?.startColumn ?? 1,
      endLineNumber: range?.endLineNumber ?? 1,
      endColumn: range?.endColumn ?? 1,
    }
  })
}

function isMarkedString(value: unknown): value is { language: string; value: string } {
  return isRecord(value) && typeof value.language === 'string' && typeof value.value === 'string'
}

function isMarkupContent(
  value: unknown,
): value is { kind: 'markdown' | 'plaintext'; value: string } {
  return (
    isRecord(value) &&
    (value.kind === 'markdown' || value.kind === 'plaintext') &&
    typeof value.value === 'string'
  )
}

function toMonacoHoverContents(contents: HoverResponse['contents']): monaco.IMarkdownString[] {
  if (!contents) {
    return []
  }

  const normalized = Array.isArray(contents) ? contents : [contents]

  return normalized.flatMap((entry) => {
    if (typeof entry === 'string') {
      return [{ value: escapeMarkdown(entry) }]
    }

    if (isMarkedString(entry)) {
      return [
        {
          value: `\`\`\`${entry.language}\n${entry.value}\n\`\`\``,
        },
      ]
    }

    if (isMarkupContent(entry) && entry.kind === 'markdown') {
      return [{ value: entry.value }]
    }

    if (isMarkupContent(entry)) {
      return [{ value: escapeMarkdown(entry.value) }]
    }

    return []
  })
}

function ensureHdlLspFeaturesRegistered() {
  if (featuresRegistered) {
    return
  }

  featuresRegistered = true

  for (const language of ['verilog', 'systemverilog'] as const) {
    monaco.languages.registerHoverProvider(language, {
      async provideHover(model, position) {
        const current = runtime
        if (!current) {
          return null
        }

        const uri = model.uri.toString()
        if (!current.openDocuments.has(uri)) {
          return null
        }

        const response = (await requestLsp(current, 'textDocument/hover', {
          textDocument: { uri },
          position: toLspPosition(position),
        }).catch(() => null)) as HoverResponse | null

        if (!response) {
          return null
        }

        const contents = toMonacoHoverContents(response.contents)
        if (contents.length === 0) {
          return null
        }

        return {
          contents,
          range: toMonacoRange(response.range),
        }
      },
    })
  }
}

function getWorkspaceFolderName(rootUri: string): string {
  const normalized = rootUri.replace(/\/+$/, '')
  const slashIndex = normalized.lastIndexOf('/')
  return slashIndex >= 0 ? normalized.slice(slashIndex + 1) || 'aspen-hdl-lsp' : 'aspen-hdl-lsp'
}

function applyDiagnosticsToModel(
  model: monaco.editor.ITextModel,
  markers: monaco.editor.IMarkerData[],
) {
  monaco.editor.setModelMarkers(model, HDL_LSP_MARKER_OWNER, markers)
}

function applyStoredDiagnostics(current: HdlLspRuntime, uri: string) {
  const model = monaco.editor.getModel(monaco.Uri.parse(uri))
  if (!model) {
    return
  }

  applyDiagnosticsToModel(model, current.diagnosticsByUri.get(uri) ?? [])
}

async function sendLspMessage(current: HdlLspRuntime, message: JsonRpcMessage) {
  await current.transport.send(message)
}

async function sendLspNotification(current: HdlLspRuntime, method: string, params?: unknown) {
  await sendLspMessage(current, {
    jsonrpc: '2.0',
    method,
    params,
  })
}

async function sendLspResponse(current: HdlLspRuntime, id: JsonRpcId, result: unknown) {
  await sendLspMessage(current, {
    jsonrpc: '2.0',
    id,
    result,
  })
}

async function sendLspError(
  current: HdlLspRuntime,
  id: JsonRpcId,
  code: number,
  message: string,
  data?: unknown,
) {
  await sendLspMessage(current, {
    jsonrpc: '2.0',
    id,
    error: {
      code,
      message,
      data,
    },
  })
}

function requestLsp(current: HdlLspRuntime, method: string, params?: unknown): Promise<unknown> {
  const id = current.nextRequestId
  current.nextRequestId += 1

  return new Promise((resolve, reject) => {
    current.pendingRequests.set(id, { resolve, reject })

    void sendLspMessage(current, {
      jsonrpc: '2.0',
      id,
      method,
      params,
    } satisfies JsonRpcRequest).catch((error) => {
      current.pendingRequests.delete(id)
      reject(error)
    })
  })
}

async function initializeRuntime(current: HdlLspRuntime) {
  await requestLsp(current, 'initialize', {
    processId: null,
    clientInfo: {
      name: 'aspen',
    },
    rootUri: current.rootUri,
    workspaceFolders: [
      {
        uri: current.rootUri,
        name: getWorkspaceFolderName(current.rootUri),
      },
    ],
    capabilities: {
      workspace: {
        workspaceFolders: true,
      },
      textDocument: {
        hover: {
          contentFormat: ['markdown', 'plaintext'],
        },
        publishDiagnostics: {},
      },
    },
  })

  await sendLspNotification(current, 'initialized', {})
}

async function handleServerRequest(
  current: HdlLspRuntime,
  message: { id: JsonRpcId; method: string; params?: unknown },
) {
  switch (message.method) {
    case 'client/registerCapability':
    case 'client/unregisterCapability':
    case 'window/workDoneProgress/create':
      await sendLspResponse(current, message.id, null)
      return
    case 'workspace/configuration':
      await sendLspResponse(current, message.id, [])
      return
    default:
      await sendLspError(
        current,
        message.id,
        -32601,
        `Unsupported server request: ${message.method}`,
      )
  }
}

function handleServerNotification(current: HdlLspRuntime, method: string, params?: unknown) {
  if (
    method !== 'textDocument/publishDiagnostics' ||
    !isRecord(params) ||
    typeof params.uri !== 'string'
  ) {
    return
  }

  const payload = params as unknown as PublishDiagnosticsParams
  const markers = toMonacoMarkers(Array.isArray(payload.diagnostics) ? payload.diagnostics : [])
  current.diagnosticsByUri.set(payload.uri, markers)
  applyStoredDiagnostics(current, payload.uri)
}

function handleIncomingMessage(current: HdlLspRuntime, message: unknown) {
  if (!isRecord(message) || message.jsonrpc !== '2.0') {
    return
  }

  if (typeof message.method === 'string') {
    if (typeof message.id === 'number') {
      void handleServerRequest(current, {
        id: message.id,
        method: message.method,
        params: message.params,
      })
      return
    }

    handleServerNotification(current, message.method, message.params)
    return
  }

  if (typeof message.id !== 'number') {
    return
  }

  const pendingRequest = current.pendingRequests.get(message.id)
  if (!pendingRequest) {
    return
  }

  current.pendingRequests.delete(message.id)

  if (isRecord(message.error) && typeof message.error.message === 'string') {
    pendingRequest.reject(new Error(message.error.message))
    return
  }

  pendingRequest.resolve(message.result)
}

function bindModelToRuntime(
  current: HdlLspRuntime,
  model: monaco.editor.ITextModel,
  language: EditorLanguage,
) {
  const uri = model.uri.toString()
  const existing = current.openDocuments.get(uri)
  if (existing?.model === model) {
    applyStoredDiagnostics(current, uri)
    return
  }

  existing?.changeDisposable.dispose()
  existing?.disposeDisposable.dispose()

  void sendLspNotification(current, 'textDocument/didOpen', {
    textDocument: {
      uri,
      languageId: normalizeEditorLanguage(language),
      version: model.getVersionId(),
      text: model.getValue(),
    },
  })

  const changeDisposable = model.onDidChangeContent((event) => {
    if (runtime !== current) {
      return
    }

    void sendLspNotification(current, 'textDocument/didChange', {
      textDocument: {
        uri,
        version: model.getVersionId(),
      },
      contentChanges:
        event.changes.length > 0
          ? event.changes.map((change) => ({
              range: {
                start: {
                  line: change.range.startLineNumber - 1,
                  character: change.range.startColumn - 1,
                },
                end: {
                  line: change.range.endLineNumber - 1,
                  character: change.range.endColumn - 1,
                },
              },
              rangeLength: change.rangeLength,
              text: change.text,
            }))
          : [{ text: model.getValue() }],
    })
  })

  const disposeDisposable = model.onWillDispose(() => {
    current.openDocuments.delete(uri)
    changeDisposable.dispose()
    disposeDisposable.dispose()

    if (runtime === current) {
      void sendLspNotification(current, 'textDocument/didClose', {
        textDocument: { uri },
      })
    }
  })

  current.openDocuments.set(uri, {
    model,
    changeDisposable,
    disposeDisposable,
  })

  applyStoredDiagnostics(current, uri)
}

async function disposeRuntime(target: HdlLspRuntime | null = runtime) {
  if (!target) {
    return
  }

  if (runtime === target) {
    runtime = null
  }

  for (const uri of new Set([...target.diagnosticsByUri.keys(), ...target.openDocuments.keys()])) {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri))
    if (model) {
      applyDiagnosticsToModel(model, [])
    }
  }

  for (const binding of target.openDocuments.values()) {
    binding.changeDisposable.dispose()
    binding.disposeDisposable.dispose()
  }

  target.openDocuments.clear()
  target.diagnosticsByUri.clear()

  for (const pendingRequest of target.pendingRequests.values()) {
    pendingRequest.reject(new Error('HDL LSP session stopped'))
  }

  target.pendingRequests.clear()

  await target.transport.dispose()
  await invoke('hdl_lsp_stop', {
    request: {
      sessionId: target.sessionId,
    },
  }).catch(() => undefined)
}

export async function ensureHdlLspSession(
  config: HdlLspSessionConfig,
): Promise<HdlLspStartResponse | null> {
  ensureHdlLspFeaturesRegistered()
  const filesKey = config.filesKey ?? ''

  if (runtime?.sessionId === config.sessionId && runtime.filesKey === filesKey) {
    return {
      session_id: runtime.sessionId,
      root_uri: runtime.rootUri,
      available: true,
    }
  }

  if (pendingSessionId === `${config.sessionId}:${filesKey}` && pendingSessionPromise) {
    return pendingSessionPromise
  }

  pendingSessionId = `${config.sessionId}:${filesKey}`
  pendingSessionPromise = (async () => {
    await disposeRuntime()

    const response = await invoke<HdlLspStartResponse>('hdl_lsp_start', {
      request: {
        sessionId: config.sessionId,
        rootUri: config.rootUri,
        files: config.files,
      },
    })

    if (!response.available || !response.root_uri) {
      return null
    }

    const transport = new TauriMessageTransport(config.sessionId)
    const nextRuntime: HdlLspRuntime = {
      sessionId: config.sessionId,
      rootUri: response.root_uri,
      filesKey,
      transport,
      nextRequestId: 1,
      pendingRequests: new Map(),
      diagnosticsByUri: new Map(),
      openDocuments: new Map(),
    }

    transport.setListener((message) => {
      handleIncomingMessage(nextRuntime, message)
    })

    runtime = nextRuntime

    try {
      await initializeRuntime(nextRuntime)
    } catch (error) {
      await disposeRuntime(nextRuntime)
      throw error
    }

    return response
  })()

  try {
    return await pendingSessionPromise
  } finally {
    if (pendingSessionId === `${config.sessionId}:${filesKey}`) {
      pendingSessionId = null
      pendingSessionPromise = null
    }
  }
}

export function ensureHdlTextModel(
  spec: HdlTextModelSpec,
  options: { rootUri: string },
): monaco.editor.ITextModel {
  ensureHdlLspFeaturesRegistered()

  const uri = monaco.Uri.parse(buildEditorFileUri(options.rootUri, spec.path))
  const existing = monaco.editor.getModel(uri)
  const language = normalizeEditorLanguage(spec.language)

  if (existing) {
    if (existing.getValue() !== spec.content) {
      existing.setValue(spec.content)
    }
    if (existing.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(existing, language)
    }
    if (runtime?.rootUri === options.rootUri && isHdlLanguage(language)) {
      bindModelToRuntime(runtime, existing, language)
    }
    return existing
  }

  const model = monaco.editor.createModel(spec.content, language, uri)

  if (runtime?.rootUri === options.rootUri && isHdlLanguage(language)) {
    bindModelToRuntime(runtime, model, language)
  }

  return model
}

export async function stopHdlLspSession(sessionId?: string | null) {
  if (!runtime) {
    return
  }

  if (sessionId && runtime.sessionId !== sessionId) {
    return
  }

  await disposeRuntime(runtime)
}

export function buildHdlProjectSessionId(projectPath: string | null, sessionId: number): string {
  if (projectPath) {
    return `project:${normalizeEditorPath(projectPath)}`
  }

  return `session:${sessionId}`
}
