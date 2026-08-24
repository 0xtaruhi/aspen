import { afterEach, describe, expect, it, vi } from 'vitest'

import type { JsonRpcMessage } from '@/lib/hdl-json-rpc'

import {
  JsonRpcRequestManager,
  JsonRpcRequestTimeoutError,
  JsonRpcResponseError,
} from '@/lib/hdl-json-rpc'

afterEach(() => {
  vi.useRealTimers()
})

describe('JsonRpcRequestManager', () => {
  it('resolves a matching response and releases its pending entry', async () => {
    const messages: JsonRpcMessage[] = []
    const manager = new JsonRpcRequestManager(async (message) => {
      messages.push(message)
    }, 1_000)

    const response = manager.request('textDocument/hover', { uri: 'file:///top.sv' })

    expect(messages).toEqual([
      {
        jsonrpc: '2.0',
        id: 1,
        method: 'textDocument/hover',
        params: { uri: 'file:///top.sv' },
      },
    ])
    expect(manager.handleResponse({ id: 1, result: { contents: 'signal' } })).toBe(true)
    await expect(response).resolves.toEqual({ contents: 'signal' })
    expect(manager.pendingCount).toBe(0)
  })

  it('preserves JSON-RPC error details', async () => {
    const manager = new JsonRpcRequestManager(async () => undefined, 1_000)
    const response = manager.request('initialize')

    manager.handleResponse({
      id: 1,
      error: { code: -32603, message: 'server failed', data: { retryable: false } },
    })

    const error = await response.catch((reason: unknown) => reason)

    expect(error).toBeInstanceOf(JsonRpcResponseError)
    expect(error).toMatchObject({
      name: 'JsonRpcResponseError',
      message: 'server failed',
      code: -32603,
      data: { retryable: false },
    })
  })

  it('times out a stalled request and ignores a late response', async () => {
    vi.useFakeTimers()
    const manager = new JsonRpcRequestManager(async () => undefined, 250)
    const response = manager.request('initialize')
    const rejection = response.catch((reason: unknown) => reason)
    await vi.advanceTimersByTimeAsync(250)

    const error = await rejection
    expect(error).toBeInstanceOf(JsonRpcRequestTimeoutError)
    expect(error).toMatchObject({
      name: 'JsonRpcRequestTimeoutError',
      method: 'initialize',
      requestId: 1,
      timeoutMs: 250,
    })
    expect(manager.pendingCount).toBe(0)
    expect(manager.handleResponse({ id: 1, result: null })).toBe(false)
  })

  it('rejects all pending requests when disposed', async () => {
    const manager = new JsonRpcRequestManager(async () => undefined, 1_000)
    const first = manager.request('initialize')
    const second = manager.request('textDocument/hover')
    const firstRejection = expect(first).rejects.toThrow('HDL LSP session stopped')
    const secondRejection = expect(second).rejects.toThrow('HDL LSP session stopped')

    manager.dispose(new Error('HDL LSP session stopped'))

    await Promise.all([firstRejection, secondRejection])
    expect(manager.pendingCount).toBe(0)
    await expect(manager.request('shutdown')).rejects.toThrow('disposed')
  })

  it('rejects a request when transport send fails', async () => {
    const manager = new JsonRpcRequestManager(async () => {
      throw new Error('transport unavailable')
    }, 1_000)

    await expect(manager.request('initialize')).rejects.toThrow('transport unavailable')
    expect(manager.pendingCount).toBe(0)
  })
})
