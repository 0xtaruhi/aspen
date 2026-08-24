import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
const transportState = vi.hoisted(() => ({ respond: true, requests: 0 }))

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('monaco-editor/editor/editor.api', () => ({
  MarkerSeverity: { Error: 8, Warning: 4, Info: 2, Hint: 1 },
  MarkerTag: { Unnecessary: 1, Deprecated: 2 },
  Uri: { parse: (value: string) => ({ toString: () => value }) },
  editor: {
    getModel: vi.fn(() => null),
    setModelMarkers: vi.fn(),
  },
  languages: {
    registerHoverProvider: vi.fn(),
  },
}))
vi.mock('@/lib/hdl-lsp-transport', () => ({
  TauriMessageTransport: class {
    private listener?: (message: unknown) => void

    setListener(listener: (message: unknown) => void) {
      this.listener = listener
    }

    async send(message: unknown) {
      if (
        typeof message === 'object' &&
        message !== null &&
        'id' in message &&
        typeof message.id === 'number'
      ) {
        transportState.requests += 1
        if (transportState.respond) {
          queueMicrotask(() => {
            this.listener?.({ jsonrpc: '2.0', id: message.id, result: {} })
          })
        }
      }
    }

    async dispose() {}
  },
}))

import { ensureHdlLspSession, stopHdlLspSession } from '@/lib/hdl-lsp'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

beforeEach(() => {
  invoke.mockReset()
  transportState.respond = true
  transportState.requests = 0
})

describe('HDL LSP session lifecycle', () => {
  it('stops a backend session when the editor closes while startup is pending', async () => {
    const startResponse = deferred<{
      session_id: string
      root_uri: string
      available: boolean
    }>()
    let backendSessionId = ''
    invoke.mockImplementation((command: string, payload?: { request: { sessionId: string } }) => {
      if (command === 'hdl_lsp_start') {
        backendSessionId = payload?.request.sessionId ?? ''
        return startResponse.promise
      }
      if (command === 'hdl_lsp_stop') {
        return Promise.resolve()
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    })

    const start = ensureHdlLspSession({
      sessionId: 'project:test',
      filesKey: 'top.sv',
      files: [{ path: 'top.sv', content: 'module top; endmodule' }],
    })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('hdl_lsp_start', expect.anything()))

    await expect(stopHdlLspSession('project:test')).resolves.toBeUndefined()
    startResponse.resolve({
      session_id: backendSessionId,
      root_uri: 'file:///tmp/aspen-hdl-lsp/project-test',
      available: true,
    })

    await expect(start).resolves.toBeNull()
    expect(invoke).toHaveBeenCalledWith('hdl_lsp_stop', {
      request: { sessionId: backendSessionId },
    })
  })

  it('replaces an unresolved start without letting stale cleanup stop the new process', async () => {
    const firstResponse = deferred<{
      session_id: string
      root_uri: string
      available: boolean
    }>()
    const startedSessionIds: string[] = []
    const stoppedSessionIds: string[] = []
    invoke.mockImplementation((command: string, payload?: { request: { sessionId: string } }) => {
      if (command === 'hdl_lsp_start') {
        const sessionId = payload?.request.sessionId ?? ''
        startedSessionIds.push(sessionId)
        return startedSessionIds.length === 1
          ? firstResponse.promise
          : Promise.resolve({
              session_id: sessionId,
              root_uri: 'file:///tmp/aspen-hdl-lsp/project-test-new',
              available: true,
            })
      }
      if (command === 'hdl_lsp_stop') {
        stoppedSessionIds.push(payload?.request.sessionId ?? '')
        return Promise.resolve()
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    })

    const first = ensureHdlLspSession({
      sessionId: 'project:test',
      filesKey: 'old',
      files: [{ path: 'old.sv', content: 'module old; endmodule' }],
    })
    await vi.waitFor(() => expect(startedSessionIds).toHaveLength(1))
    await expect(stopHdlLspSession('project:test')).resolves.toBeUndefined()

    const replacement = ensureHdlLspSession({
      sessionId: 'project:test',
      filesKey: 'new',
      files: [{ path: 'new.sv', content: 'module new; endmodule' }],
    })

    await expect(replacement).resolves.toMatchObject({
      root_uri: 'file:///tmp/aspen-hdl-lsp/project-test-new',
    })
    expect(startedSessionIds).toHaveLength(2)
    expect(startedSessionIds[0]).not.toBe(startedSessionIds[1])

    firstResponse.resolve({
      session_id: startedSessionIds[0] ?? '',
      root_uri: 'file:///tmp/aspen-hdl-lsp/project-test-old',
      available: true,
    })
    await expect(first).resolves.toBeNull()
    await vi.waitFor(() => expect(stoppedSessionIds).toContain(startedSessionIds[0]))
    expect(stoppedSessionIds).not.toContain(startedSessionIds[1])

    await stopHdlLspSession('project:test')
    expect(stoppedSessionIds).toContain(startedSessionIds[1])
  })

  it('returns null when stopped during initialization', async () => {
    transportState.respond = false
    invoke.mockImplementation((command: string, payload?: { request: { sessionId: string } }) => {
      if (command === 'hdl_lsp_start') {
        return Promise.resolve({
          session_id: payload?.request.sessionId ?? '',
          root_uri: 'file:///tmp/aspen-hdl-lsp/project-test',
          available: true,
        })
      }
      if (command === 'hdl_lsp_stop') {
        return Promise.resolve()
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    })

    const start = ensureHdlLspSession({
      sessionId: 'project:test',
      filesKey: 'top.sv',
      files: [{ path: 'top.sv', content: 'module top; endmodule' }],
    })
    await vi.waitFor(() => expect(transportState.requests).toBe(1))

    await expect(stopHdlLspSession('project:test')).resolves.toBeUndefined()
    await expect(start).resolves.toBeNull()
  })
})
