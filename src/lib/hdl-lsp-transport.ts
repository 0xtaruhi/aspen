import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

type HdlLspEventPayload = {
  session_id: string
  message: unknown
}

type LspMessageListener = (message: unknown) => void

export class TauriMessageTransport {
  private listener?: LspMessageListener
  private readonly queuedMessages: unknown[] = []
  private disposed = false
  private readonly unlistenPromise: Promise<UnlistenFn>

  constructor(private readonly sessionId: string) {
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
