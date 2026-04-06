import type {
  SynthesisNetlistGraphChunkSummaryV1,
  SynthesisNetlistGraphChunkV1,
  SynthesisNetlistGraphInterconnectV1,
} from '@/lib/hardware-client'
import type { NetlistLayoutResult } from '@/lib/netlist-graph-layout-core'
export type { NetlistLayoutRect, NetlistLayoutResult } from '@/lib/netlist-graph-layout-core'

type NetlistLayoutRequest =
  | {
      requestId: number
      kind: 'atlas'
      chunks: SynthesisNetlistGraphChunkSummaryV1[]
      interconnects: SynthesisNetlistGraphInterconnectV1[]
    }
  | {
      requestId: number
      kind: 'chunk'
      chunk: SynthesisNetlistGraphChunkV1
    }

type NetlistLayoutJob =
  | {
      kind: 'atlas'
      chunks: SynthesisNetlistGraphChunkSummaryV1[]
      interconnects: SynthesisNetlistGraphInterconnectV1[]
    }
  | {
      kind: 'chunk'
      chunk: SynthesisNetlistGraphChunkV1
    }

type NetlistLayoutResponse = {
  requestId: number
  result: NetlistLayoutResult
}

let worker: Worker | null = null
let requestId = 0
const pending = new Map<number, (result: NetlistLayoutResult) => void>()

function getWorker() {
  if (worker) {
    return worker
  }

  worker = new Worker(new URL('../workers/netlist-graph-layout.worker.ts', import.meta.url), {
    type: 'module',
  })
  worker.addEventListener('message', (event: MessageEvent<NetlistLayoutResponse>) => {
    const resolve = pending.get(event.data.requestId)
    if (!resolve) {
      return
    }

    pending.delete(event.data.requestId)
    resolve(event.data.result)
  })

  return worker
}

function dispatchLayout(request: NetlistLayoutJob) {
  const nextRequestId = ++requestId
  const activeWorker = getWorker()

  return new Promise<NetlistLayoutResult>((resolve) => {
    pending.set(nextRequestId, resolve)
    activeWorker.postMessage({
      ...request,
      requestId: nextRequestId,
    } satisfies NetlistLayoutRequest)
  })
}

export function computeNetlistAtlasLayout(
  chunks: SynthesisNetlistGraphChunkSummaryV1[],
  interconnects: SynthesisNetlistGraphInterconnectV1[],
) {
  return dispatchLayout({
    kind: 'atlas',
    chunks,
    interconnects,
  })
}

export function computeNetlistChunkLayout(chunk: SynthesisNetlistGraphChunkV1) {
  return dispatchLayout({
    kind: 'chunk',
    chunk,
  })
}
