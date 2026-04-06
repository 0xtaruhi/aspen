import type {
  SynthesisNetlistGraphChunkSummaryV1,
  SynthesisNetlistGraphChunkV1,
  SynthesisNetlistGraphInterconnectV1,
} from '@/lib/hardware-client'
import {
  computeNetlistAtlasLayoutSync,
  computeNetlistChunkLayoutSync,
  type NetlistLayoutResult,
} from '@/lib/netlist-graph-layout-core'

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

type NetlistLayoutResponse = {
  requestId: number
  result: NetlistLayoutResult
}

self.addEventListener('message', (event: MessageEvent<NetlistLayoutRequest>) => {
  const request = event.data
  const result =
    request.kind === 'atlas'
      ? computeNetlistAtlasLayoutSync(request.chunks, request.interconnects)
      : computeNetlistChunkLayoutSync(request.chunk)

  self.postMessage({
    requestId: request.requestId,
    result,
  } satisfies NetlistLayoutResponse)
})
