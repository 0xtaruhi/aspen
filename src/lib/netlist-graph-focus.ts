import type { SynthesisNetlistGraphChunkV1 } from '@/lib/hardware-client'

export type NetlistSelectionScope = 'full' | 'fanin' | 'fanout' | 'cone'

export type NetlistFocusResult = {
  nodeIds: Set<string>
  edgeIds: Set<string>
  upstreamNodeIds: Set<string>
  downstreamNodeIds: Set<string>
  upstreamEdgeIds: Set<string>
  downstreamEdgeIds: Set<string>
}

export function computeNetlistFocus(
  chunk: SynthesisNetlistGraphChunkV1 | null,
  selectedNodeId: string | null,
  scope: NetlistSelectionScope,
): NetlistFocusResult {
  if (!chunk) {
    return {
      nodeIds: new Set(),
      edgeIds: new Set(),
      upstreamNodeIds: new Set(),
      downstreamNodeIds: new Set(),
      upstreamEdgeIds: new Set(),
      downstreamEdgeIds: new Set(),
    }
  }

  const allNodeIds = new Set(chunk.nodes.map((node) => node.id))
  const allEdgeIds = new Set(chunk.edges.map((edge) => edge.id))
  if (!selectedNodeId || scope === 'full' || !allNodeIds.has(selectedNodeId)) {
    return {
      nodeIds: allNodeIds,
      edgeIds: allEdgeIds,
      upstreamNodeIds: new Set(),
      downstreamNodeIds: new Set(),
      upstreamEdgeIds: new Set(),
      downstreamEdgeIds: new Set(),
    }
  }

  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()

  for (const node of chunk.nodes) {
    outgoing.set(node.id, [])
    incoming.set(node.id, [])
  }

  for (const edge of chunk.edges) {
    outgoing.get(edge.source_id)?.push(edge.target_id)
    incoming.get(edge.target_id)?.push(edge.source_id)
  }

  const upstream = traverseGraph(selectedNodeId, incoming)
  const downstream = traverseGraph(selectedNodeId, outgoing)
  const nodeIds =
    scope === 'fanin'
      ? upstream
      : scope === 'fanout'
        ? downstream
        : new Set([...upstream, ...downstream])

  const upstreamEdgeIds = new Set(
    chunk.edges
      .filter((edge) => upstream.has(edge.source_id) && upstream.has(edge.target_id))
      .map((edge) => edge.id),
  )
  const downstreamEdgeIds = new Set(
    chunk.edges
      .filter((edge) => downstream.has(edge.source_id) && downstream.has(edge.target_id))
      .map((edge) => edge.id),
  )
  const edgeIds = new Set(
    chunk.edges
      .filter((edge) => nodeIds.has(edge.source_id) && nodeIds.has(edge.target_id))
      .map((edge) => edge.id),
  )

  return {
    nodeIds,
    edgeIds,
    upstreamNodeIds: upstream,
    downstreamNodeIds: downstream,
    upstreamEdgeIds,
    downstreamEdgeIds,
  }
}

function traverseGraph(seedId: string, adjacency: Map<string, string[]>) {
  const visited = new Set<string>([seedId])
  const queue = [seedId]

  for (let index = 0; index < queue.length; index += 1) {
    const currentId = queue[index]
    for (const nextId of adjacency.get(currentId) ?? []) {
      if (visited.has(nextId)) {
        continue
      }

      visited.add(nextId)
      queue.push(nextId)
    }
  }

  return visited
}
