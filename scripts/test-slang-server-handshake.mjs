import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const executable = process.argv[2]
if (!executable) throw new Error('Usage: node scripts/test-slang-server-handshake.mjs <path>')

const workspace = await mkdtemp(resolve(tmpdir(), 'aspen-lsp-handshake-'))
const stderr = []
let child
let childClosed

async function waitForClose(timeoutMs = 5_000) {
  let timeout
  try {
    await Promise.race([
      childClosed,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('LSP server ignored exit')), timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}

try {
  await writeFile(resolve(workspace, 'top.sv'), 'module top; endmodule\n')
  child = spawn(resolve(executable), [], { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'] })
  childClosed = new Promise((resolveClose, rejectClose) => {
    child.once('close', resolveClose)
    child.once('error', rejectClose)
  })
  void childClosed.catch(() => {})
  child.stderr.on('data', (chunk) => stderr.push(chunk.toString()))

  let buffer = Buffer.alloc(0)
  const messages = []
  const waiters = []
  child.stdout.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (true) {
      const headerEnd = buffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) break
      const match = /content-length:\s*(\d+)/i.exec(buffer.subarray(0, headerEnd).toString())
      if (!match) throw new Error('LSP response omitted Content-Length')
      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (buffer.length < bodyStart + length) break
      const message = JSON.parse(buffer.subarray(bodyStart, bodyStart + length).toString())
      buffer = buffer.subarray(bodyStart + length)
      const waiter = waiters.shift()
      if (waiter) waiter(message)
      else messages.push(message)
    }
  })

  const send = (message) => {
    const body = JSON.stringify({ jsonrpc: '2.0', ...message })
    child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
  }
  const receive = () =>
    messages.length
      ? Promise.resolve(messages.shift())
      : new Promise((resolveMessage, reject) => {
          const timeout = setTimeout(
            () => reject(new Error('Timed out waiting for LSP response')),
            15_000,
          )
          waiters.push((message) => {
            clearTimeout(timeout)
            resolveMessage(message)
          })
        })
  const response = async (id) => {
    while (true) {
      const message = await receive()
      if (message.id === id && !message.method) return message
      if (message.id !== undefined && message.method) {
        send({
          id: message.id,
          result: message.method === 'workspace/configuration' ? [] : null,
        })
      }
    }
  }

  const rootUri = pathToFileURL(workspace).href
  send({
    id: 1,
    method: 'initialize',
    params: {
      processId: null,
      rootUri,
      workspaceFolders: [{ uri: rootUri, name: 'handshake' }],
      capabilities: {},
    },
  })
  const initialized = await response(1)
  if (initialized.error) throw new Error(`LSP initialize failed: ${initialized.error.message}`)

  const capabilities = initialized.result?.capabilities ?? {}
  for (const capability of [
    'completionProvider',
    'hoverProvider',
    'definitionProvider',
    'referencesProvider',
    'renameProvider',
  ]) {
    if (!capabilities[capability]) throw new Error(`LSP capability missing: ${capability}`)
  }

  send({ method: 'initialized', params: {} })
  send({ id: 2, method: 'shutdown', params: null })
  const shutdown = await response(2)
  if (shutdown.error) throw new Error(`LSP shutdown failed: ${shutdown.error.message}`)
  send({ method: 'exit', params: null })
  child.stdin.end()
  await waitForClose()

  console.log(
    `slang-server handshake passed (${initialized.result?.serverInfo?.version?.trim() ?? 'unknown version'})`,
  )
} catch (error) {
  const details = stderr.join('').trim()
  throw new Error(
    `${error instanceof Error ? error.message : String(error)}${details ? `\n${details}` : ''}`,
    { cause: error },
  )
} finally {
  if (child && child.exitCode === null) child.kill()
  await childClosed?.catch(() => {})
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
