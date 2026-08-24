export type JsonRpcId = number

export type JsonRpcRequest = {
  jsonrpc: '2.0'
  id: JsonRpcId
  method: string
  params?: unknown
}

export type JsonRpcNotification = {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export type JsonRpcSuccessResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
}

export type JsonRpcErrorResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  error: {
    code: number
    message: string
    data?: unknown
  }
}

export type JsonRpcMessage =
  JsonRpcRequest | JsonRpcNotification | JsonRpcSuccessResponse | JsonRpcErrorResponse

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timeout: ReturnType<typeof setTimeout>
}

type JsonRpcResponse = {
  id: JsonRpcId
  result?: unknown
  error?: {
    code?: number
    message: string
    data?: unknown
  }
}

export class JsonRpcRequestTimeoutError extends Error {
  readonly method: string
  readonly requestId: JsonRpcId
  readonly timeoutMs: number

  constructor(method: string, requestId: JsonRpcId, timeoutMs: number) {
    super(`JSON-RPC request timed out after ${timeoutMs} ms: ${method}`)
    this.name = 'JsonRpcRequestTimeoutError'
    this.method = method
    this.requestId = requestId
    this.timeoutMs = timeoutMs
  }
}

export class JsonRpcResponseError extends Error {
  readonly code?: number
  readonly data?: unknown

  constructor(message: string, code?: number, data?: unknown) {
    super(message)
    this.name = 'JsonRpcResponseError'
    this.code = code
    this.data = data
  }
}

export class JsonRpcRequestManager {
  private nextRequestId = 1
  private readonly pendingRequests = new Map<JsonRpcId, PendingRequest>()
  private disposed = false

  constructor(
    private readonly send: (message: JsonRpcMessage) => Promise<void>,
    private readonly requestTimeoutMs: number,
  ) {
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new RangeError('JSON-RPC request timeout must be a positive finite number')
    }
  }

  get pendingCount(): number {
    return this.pendingRequests.size
  }

  request(method: string, params?: unknown): Promise<unknown> {
    if (this.disposed) {
      return Promise.reject(new Error('JSON-RPC request manager is disposed'))
    }

    const id = this.nextRequestId
    this.nextRequestId += 1

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.rejectRequest(id, new JsonRpcRequestTimeoutError(method, id, this.requestTimeoutMs))
      }, this.requestTimeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timeout })

      void this.send({
        jsonrpc: '2.0',
        id,
        method,
        params,
      }).catch((error: unknown) => {
        this.rejectRequest(id, error)
      })
    })
  }

  handleResponse(response: JsonRpcResponse): boolean {
    const pending = this.takePendingRequest(response.id)
    if (!pending) {
      return false
    }

    if (response.error) {
      pending.reject(
        new JsonRpcResponseError(response.error.message, response.error.code, response.error.data),
      )
    } else {
      pending.resolve(response.result)
    }

    return true
  }

  dispose(reason: Error = new Error('JSON-RPC session stopped')): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    for (const id of [...this.pendingRequests.keys()]) {
      this.rejectRequest(id, reason)
    }
  }

  private rejectRequest(id: JsonRpcId, reason: unknown): boolean {
    const pending = this.takePendingRequest(id)
    if (!pending) {
      return false
    }

    pending.reject(reason)
    return true
  }

  private takePendingRequest(id: JsonRpcId): PendingRequest | undefined {
    const pending = this.pendingRequests.get(id)
    if (!pending) {
      return undefined
    }

    this.pendingRequests.delete(id)
    clearTimeout(pending.timeout)
    return pending
  }
}
