import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api'
import { MonacoLspClient } from 'monaco-editor/esm/external/monaco-lsp-client/out/index.js'

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

type HdlLspStatusResponse = {
  available: boolean
  command: string | null
}

type HdlLspStartResponse = {
  session_id: string
  root_uri: string
  available: boolean
  command: string | null
}

type HdlLspEventPayload = {
  session_id: string
  message: unknown
}

type HdlLspTransportState = {
  state: {
    state: 'open' | 'closed'
    error?: unknown
  }
}

type HdlLspSessionConfig = {
  sessionId: string
  rootUri?: string | null
  files: HdlProjectSourceFile[]
}

type HdlTextModelSpec = {
  path: string
  content: string
  language: EditorLanguage
}

type LspMessageListener = (message: unknown) => void

class TauriMessageTransport {
  readonly id: string
  readonly state: HdlLspTransportState = {
    state: {
      state: 'open',
    },
  }

  private readonly sessionId: string
  private listener?: LspMessageListener
  private readonly queuedMessages: unknown[] = []
  private disposed = false
  private readonly unlistenPromise: Promise<UnlistenFn>

  constructor(sessionId: string) {
    this.sessionId = sessionId
    this.id = `tauri-hdl-lsp:${sessionId}`
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
    this.state.state = {
      state: 'closed',
    }

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
  transport: TauriMessageTransport
  client: MonacoLspClient
}

let runtime: HdlLspRuntime | null = null

export async function getHdlLspStatus(): Promise<HdlLspStatusResponse> {
  return invoke<HdlLspStatusResponse>('hdl_lsp_status')
}

async function disposeRuntime() {
  if (!runtime) {
    return
  }

  const current = runtime
  runtime = null

  await current.transport.dispose()
  await invoke('hdl_lsp_stop', {
    request: {
      sessionId: current.sessionId,
    },
  }).catch(() => undefined)
}

export async function ensureHdlLspSession(
  config: HdlLspSessionConfig,
): Promise<HdlLspStartResponse | null> {
  if (runtime?.sessionId === config.sessionId) {
    return {
      session_id: runtime.sessionId,
      root_uri: runtime.rootUri,
      available: true,
      command: null,
    }
  }

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
  const client = new MonacoLspClient(transport as never)

  runtime = {
    sessionId: config.sessionId,
    rootUri: response.root_uri,
    transport,
    client,
  }

  return response
}

export function ensureHdlTextModel(
  spec: HdlTextModelSpec,
  options: { rootUri: string },
): monaco.editor.ITextModel {
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
    return existing
  }

  return monaco.editor.createModel(spec.content, language, uri)
}

export async function stopHdlLspSession(sessionId?: string | null) {
  if (!runtime) {
    return
  }

  if (sessionId && runtime.sessionId !== sessionId) {
    return
  }

  await disposeRuntime()
}

export function getActiveHdlLspRootUri() {
  return runtime?.rootUri ?? null
}

export function buildHdlProjectSessionId(projectPath: string | null, sessionId: number): string {
  if (projectPath) {
    return `project:${normalizeEditorPath(projectPath)}`
  }

  return `session:${sessionId}`
}

export function resolveHdlWorkspaceRootUri(projectPath: string | null): string | null {
  if (!projectPath) {
    return null
  }

  const normalized = projectPath.replace(/\\/g, '/')
  const lastSlash = normalized.lastIndexOf('/')
  const directory = lastSlash >= 0 ? normalized.slice(0, lastSlash) : normalized

  return directory ? `file://${directory}` : null
}
