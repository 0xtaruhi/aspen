import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())

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
        queueMicrotask(() => {
          this.listener?.({ jsonrpc: '2.0', id: message.id, result: {} })
        })
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
})

describe('HDL LSP session lifecycle', () => {
  it('stops a backend session when the editor closes while startup is pending', async () => {
    const startResponse = deferred<{
      session_id: string
      root_uri: string
      available: boolean
    }>()
    invoke.mockImplementation((command: string) => {
      if (command === 'hdl_lsp_start') {
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

    const stop = stopHdlLspSession('project:test')
    startResponse.resolve({
      session_id: 'project:test',
      root_uri: 'file:///tmp/aspen-hdl-lsp/project-test',
      available: true,
    })

    await expect(start).resolves.toBeNull()
    await stop
    expect(invoke).toHaveBeenCalledWith('hdl_lsp_stop', {
      request: { sessionId: 'project:test' },
    })
  })

  it('serializes replacement starts so stale cleanup cannot stop the new process', async () => {
    const firstResponse = deferred<{
      session_id: string
      root_uri: string
      available: boolean
    }>()
    let startCalls = 0
    invoke.mockImplementation((command: string) => {
      if (command === 'hdl_lsp_start') {
        startCalls += 1
        return startCalls === 1
          ? firstResponse.promise
          : Promise.resolve({
              session_id: 'project:test',
              root_uri: 'file:///tmp/aspen-hdl-lsp/project-test-new',
              available: true,
            })
      }
      if (command === 'hdl_lsp_stop') {
        return Promise.resolve()
      }
      return Promise.reject(new Error(`unexpected command: ${command}`))
    })

    const first = ensureHdlLspSession({
      sessionId: 'project:test',
      filesKey: 'old',
      files: [{ path: 'old.sv', content: 'module old; endmodule' }],
    })
    await vi.waitFor(() => expect(startCalls).toBe(1))
    const replacement = ensureHdlLspSession({
      sessionId: 'project:test',
      filesKey: 'new',
      files: [{ path: 'new.sv', content: 'module new; endmodule' }],
    })

    expect(startCalls).toBe(1)
    firstResponse.resolve({
      session_id: 'project:test',
      root_uri: 'file:///tmp/aspen-hdl-lsp/project-test-old',
      available: true,
    })

    await expect(first).resolves.toBeNull()
    await expect(replacement).resolves.toMatchObject({
      root_uri: 'file:///tmp/aspen-hdl-lsp/project-test-new',
    })
    expect(startCalls).toBe(2)
    await stopHdlLspSession('project:test')
  })
})
