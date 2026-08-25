import type { EditorLanguage } from '@/lib/editor-language'
import type { JsonRpcId, JsonRpcMessage } from '@/lib/hdl-json-rpc'

import { invoke } from '@tauri-apps/api/core'
import * as monaco from 'monaco-editor/editor/editor.api'
import { readonly, ref } from 'vue'

import {
  buildEditorFileUri,
  normalizeEditorLanguage,
  normalizeEditorPath,
  resolveEditorLanguage,
} from '@/lib/editor-language'
import { JsonRpcRequestManager, JsonRpcResponseError } from '@/lib/hdl-json-rpc'
import { registerHdlLspFeatures } from '@/lib/hdl-lsp-features'
import { TauriMessageTransport } from '@/lib/hdl-lsp-transport'

type HdlProjectSourceFile = {
  path: string
  content: string
}

type HdlLspStartResponse = {
  session_id: string
  root_uri: string
  available: boolean
}

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

type HdlLspSessionConfig = {
  sessionId: string
  rootUri?: string | null
  filesKey?: string
  files: HdlProjectSourceFile[]
  onFileChange?: (path: string, content: string) => void
}

type HdlTextModelSpec = {
  path: string
  content: string
  language: EditorLanguage
}

type OpenDocumentBinding = {
  model: monaco.editor.ITextModel
  changeDisposable: monaco.IDisposable
  disposeDisposable: monaco.IDisposable
}

type HdlLspRuntime = {
  sessionId: string
  backendSessionId: string
  rootUri: string
  filesKey: string
  transport: TauriMessageTransport
  requests: JsonRpcRequestManager
  diagnosticsByUri: Map<string, monaco.editor.IMarkerData[]>
  openDocuments: Map<string, OpenDocumentBinding>
  pathsByUri: Map<string, string>
  onFileChange?: (path: string, content: string) => void
}

type PendingHdlLspSession = {
  key: string
  sessionId: string
  controller: AbortController
  promise: Promise<HdlLspStartResponse | null>
}

let runtime: HdlLspRuntime | null = null
let pendingSession: PendingHdlLspSession | null = null
let featuresRegistered = false

const HDL_LSP_MARKER_OWNER = 'slang-server'
const HDL_LSP_REQUEST_TIMEOUT_MS = 15_000

export type HdlLspStatus = {
  state: 'idle' | 'starting' | 'ready' | 'unavailable' | 'error'
  detail?: string
}

const mutableHdlLspStatus = ref<HdlLspStatus>({ state: 'idle' })
export const hdlLspStatus = readonly(mutableHdlLspStatus)

function setHdlLspStatus(state: HdlLspStatus['state'], detail?: string) {
  mutableHdlLspStatus.value = { state, detail }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isHdlLanguage(language: EditorLanguage): boolean {
  return language === 'verilog' || language === 'systemverilog'
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

function ensureHdlLspFeaturesRegistered() {
  if (featuresRegistered) {
    return
  }

  featuresRegistered = true

  registerHdlLspFeatures(monaco, async (model, method, params) => {
    const current = runtime
    if (!current || !current.openDocuments.has(model.uri.toString())) return null
    try {
      const response = await requestLsp(current, method, params)
      if (runtime === current && mutableHdlLspStatus.value.state === 'error') {
        setHdlLspStatus('ready')
      }
      return response
    } catch (error) {
      if (runtime === current && !(error instanceof JsonRpcResponseError)) {
        setHdlLspStatus('error', error instanceof Error ? error.message : String(error))
      }
      throw error
    }
  })
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
  return current.requests.request(method, params)
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
        completion: {
          completionItem: {
            documentationFormat: ['markdown', 'plaintext'],
            snippetSupport: true,
          },
        },
        definition: {},
        hover: {
          contentFormat: ['markdown', 'plaintext'],
        },
        publishDiagnostics: {},
        references: {},
        rename: {},
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

  current.requests.handleResponse({
    id: message.id,
    result: message.result,
    error:
      isRecord(message.error) && typeof message.error.message === 'string'
        ? {
            code: typeof message.error.code === 'number' ? message.error.code : undefined,
            message: message.error.message,
            data: message.error.data,
          }
        : undefined,
  })
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

    const path = current.pathsByUri.get(uri)
    if (path) current.onFileChange?.(path, model.getValue())
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

  const models = [...target.openDocuments.values()].map((binding) => binding.model)
  for (const binding of target.openDocuments.values()) {
    binding.changeDisposable.dispose()
    binding.disposeDisposable.dispose()
  }

  target.openDocuments.clear()
  target.diagnosticsByUri.clear()
  target.pathsByUri.clear()
  for (const model of models) {
    if (!model.isDisposed()) model.dispose()
  }

  target.requests.dispose(new Error('HDL LSP session stopped'))

  const cleanupResults = await Promise.allSettled([
    target.transport.dispose(),
    invoke('hdl_lsp_stop', {
      request: {
        sessionId: target.backendSessionId,
      },
    }),
  ])
  const failures = cleanupResults.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  )
  if (failures.length > 0) {
    const details = failures
      .map((failure) => (failure instanceof Error ? failure.message : String(failure)))
      .join('; ')
    throw new Error(`Failed to stop HDL LSP session '${target.sessionId}': ${details}`)
  }
}

export async function ensureHdlLspSession(
  config: HdlLspSessionConfig,
): Promise<HdlLspStartResponse | null> {
  ensureHdlLspFeaturesRegistered()
  const filesKey = config.filesKey ?? ''

  if (runtime?.sessionId === config.sessionId && runtime.filesKey === filesKey) {
    runtime.onFileChange = config.onFileChange
    return {
      session_id: runtime.sessionId,
      root_uri: runtime.rootUri,
      available: true,
    }
  }

  const sessionKey = `${config.sessionId}:${filesKey}`
  if (pendingSession?.key === sessionKey) {
    return pendingSession.promise
  }

  const previousSession = pendingSession
  previousSession?.controller.abort()
  const controller = new AbortController()
  const backendSessionId = `${config.sessionId}:lsp:${crypto.randomUUID()}`
  const promise = (async () => {
    if (controller.signal.aborted) {
      return null
    }

    setHdlLspStatus('starting')
    await disposeRuntime()
    if (controller.signal.aborted) {
      return null
    }

    const response = await invoke<HdlLspStartResponse>('hdl_lsp_start', {
      request: {
        sessionId: backendSessionId,
        rootUri: config.rootUri,
        files: config.files,
      },
    })

    if (!response.available || !response.root_uri) {
      setHdlLspStatus('unavailable', 'Bundled slang-server was not found')
      return null
    }

    if (controller.signal.aborted) {
      await invoke('hdl_lsp_stop', {
        request: {
          sessionId: backendSessionId,
        },
      })
      return null
    }

    const transport = new TauriMessageTransport(backendSessionId)
    const requests = new JsonRpcRequestManager(
      (message) => transport.send(message),
      HDL_LSP_REQUEST_TIMEOUT_MS,
    )
    const nextRuntime: HdlLspRuntime = {
      sessionId: config.sessionId,
      backendSessionId,
      rootUri: response.root_uri,
      filesKey,
      transport,
      requests,
      diagnosticsByUri: new Map(),
      openDocuments: new Map(),
      pathsByUri: new Map(),
      onFileChange: config.onFileChange,
    }

    transport.setListener((message) => {
      handleIncomingMessage(nextRuntime, message)
    })

    runtime = nextRuntime

    try {
      await initializeRuntime(nextRuntime)
    } catch (error) {
      await disposeRuntime(nextRuntime)
      if (controller.signal.aborted) {
        return null
      }
      throw error
    }

    if (controller.signal.aborted) {
      await disposeRuntime(nextRuntime)
      return null
    }

    for (const file of config.files) {
      const language = resolveEditorLanguage(file.path)
      if (!isHdlLanguage(language)) continue
      const uri = buildEditorFileUri(nextRuntime.rootUri, file.path)
      nextRuntime.pathsByUri.set(uri, file.path)
      ensureHdlTextModel(
        { path: file.path, content: file.content, language },
        { rootUri: nextRuntime.rootUri },
      )
    }

    setHdlLspStatus('ready')
    return response
  })()
  const nextSession: PendingHdlLspSession = {
    key: sessionKey,
    sessionId: config.sessionId,
    controller,
    promise,
  }
  pendingSession = nextSession

  try {
    return await nextSession.promise
  } catch (error) {
    if (!controller.signal.aborted) {
      setHdlLspStatus('error', error instanceof Error ? error.message : String(error))
    }
    throw error
  } finally {
    if (pendingSession === nextSession) {
      pendingSession = null
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
  const pending = pendingSession
  const shouldCancelPending = Boolean(pending && (!sessionId || pending.sessionId === sessionId))
  if (shouldCancelPending && pending) {
    pending.controller.abort()
  }

  const current = runtime
  if (current && (!sessionId || current.sessionId === sessionId)) {
    await disposeRuntime(current)
  }
  if (!sessionId || current?.sessionId === sessionId || pending?.sessionId === sessionId) {
    setHdlLspStatus('idle')
  }
}

export function buildHdlProjectSessionId(projectPath: string | null, sessionId: number): string {
  if (projectPath) {
    return `project:${normalizeEditorPath(projectPath)}`
  }

  return `session:${sessionId}`
}
