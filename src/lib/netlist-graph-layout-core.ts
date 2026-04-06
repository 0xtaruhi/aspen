import type {
  SynthesisNetlistGraphChunkSummaryV1,
  SynthesisNetlistGraphChunkV1,
  SynthesisNetlistGraphInterconnectV1,
  SynthesisNetlistGraphNodeV1,
} from '@/lib/hardware-client'

export type NetlistLayoutRect = {
  x: number
  y: number
  width: number
  height: number
}

export type NetlistLayoutResult = {
  bounds: {
    width: number
    height: number
  }
  positions: Record<string, NetlistLayoutRect>
}

const ATLAS_CARD_WIDTH = 224
const ATLAS_CARD_HEIGHT = 124
const ATLAS_COLUMN_GAP = 72
const ATLAS_ROW_GAP = 48
const ATLAS_COMPONENT_GAP = 96

const NODE_WIDTH = 188
const PORT_WIDTH = 164
const NODE_HEIGHT = 64
const COLUMN_GAP = 82
const ROW_GAP = 28
const COMPONENT_GAP = 88
const COMPACT_LAYOUT_MAX_WIDTH = 5600
const COMPACT_LAYOUT_MAX_COLUMNS = 20

type ChunkGraphMaps = {
  outgoing: Map<string, string[]>
  incoming: Map<string, string[]>
  neighbors: Map<string, string[]>
  incomingCount: Map<string, number>
}

export function computeNetlistAtlasLayoutSync(
  chunks: SynthesisNetlistGraphChunkSummaryV1[],
  interconnects: SynthesisNetlistGraphInterconnectV1[],
): NetlistLayoutResult {
  const positions: Record<string, NetlistLayoutRect> = {}
  const adjacency = new Map<string, Array<{ id: string; weight: number }>>()

  for (const chunk of chunks) {
    adjacency.set(chunk.chunk_id, [])
  }

  for (const edge of interconnects) {
    adjacency.get(edge.source_chunk_id)?.push({ id: edge.target_chunk_id, weight: edge.edge_count })
    adjacency.get(edge.target_chunk_id)?.push({ id: edge.source_chunk_id, weight: edge.edge_count })
  }

  for (const neighbors of adjacency.values()) {
    neighbors.sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id))
  }

  const visited = new Set<string>()
  const sortedChunks = [...chunks].sort((left, right) => {
    return (
      right.port_count - left.port_count ||
      right.node_count - left.node_count ||
      left.chunk_id.localeCompare(right.chunk_id)
    )
  })

  let offsetY = 0
  let maxWidth = 0

  for (const seed of sortedChunks) {
    if (visited.has(seed.chunk_id)) {
      continue
    }

    const levelMap = new Map<string, number>()
    const queue = [seed.chunk_id]
    visited.add(seed.chunk_id)
    levelMap.set(seed.chunk_id, 0)

    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index]
      const baseLevel = levelMap.get(current) ?? 0
      for (const neighbor of adjacency.get(current) ?? []) {
        if (visited.has(neighbor.id)) {
          continue
        }
        visited.add(neighbor.id)
        levelMap.set(neighbor.id, baseLevel + 1)
        queue.push(neighbor.id)
      }
    }

    const columns = new Map<number, SynthesisNetlistGraphChunkSummaryV1[]>()
    for (const chunk of chunks) {
      const level = levelMap.get(chunk.chunk_id)
      if (level === undefined) {
        continue
      }
      const bucket = columns.get(level) ?? []
      bucket.push(chunk)
      columns.set(level, bucket)
    }

    let componentRows = 0
    const levels = [...columns.keys()].sort((left, right) => left - right)
    for (const level of levels) {
      const columnChunks = columns.get(level) ?? []
      columnChunks.sort((left, right) => {
        return (
          right.external_edge_count - left.external_edge_count ||
          right.node_count - left.node_count ||
          left.chunk_id.localeCompare(right.chunk_id)
        )
      })
      componentRows = Math.max(componentRows, columnChunks.length)
      columnChunks.forEach((chunk, rowIndex) => {
        positions[chunk.chunk_id] = {
          x: level * (ATLAS_CARD_WIDTH + ATLAS_COLUMN_GAP),
          y: offsetY + rowIndex * (ATLAS_CARD_HEIGHT + ATLAS_ROW_GAP),
          width: ATLAS_CARD_WIDTH,
          height: ATLAS_CARD_HEIGHT,
        }
      })
    }

    maxWidth = Math.max(
      maxWidth,
      levels.length * (ATLAS_CARD_WIDTH + ATLAS_COLUMN_GAP) - ATLAS_COLUMN_GAP,
    )
    offsetY +=
      Math.max(1, componentRows) * (ATLAS_CARD_HEIGHT + ATLAS_ROW_GAP) + ATLAS_COMPONENT_GAP
  }

  return {
    bounds: {
      width: Math.max(ATLAS_CARD_WIDTH, maxWidth),
      height: Math.max(ATLAS_CARD_HEIGHT, offsetY - ATLAS_COMPONENT_GAP),
    },
    positions,
  }
}

export function computeNetlistChunkLayoutSync(
  chunk: SynthesisNetlistGraphChunkV1,
): NetlistLayoutResult {
  if (chunk.nodes.length === 0) {
    return {
      bounds: {
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      },
      positions: {},
    }
  }

  const positions: Record<string, NetlistLayoutRect> = {}
  const nodeById = new Map(chunk.nodes.map((node) => [node.id, node]))
  const graphMaps = buildChunkGraphMaps(chunk)
  const components = collectConnectedComponents(chunk, graphMaps.neighbors)
  const sortedComponents = [...components].sort((left, right) => {
    return right.length - left.length || left[0].label.localeCompare(right[0].label)
  })

  let offsetY = 0
  let maxWidth = NODE_WIDTH

  for (const componentNodes of sortedComponents) {
    const componentLayout = layoutChunkComponent(componentNodes, nodeById, graphMaps)
    for (const [nodeId, rect] of Object.entries(componentLayout.positions)) {
      positions[nodeId] = {
        ...rect,
        y: rect.y + offsetY,
      }
    }

    maxWidth = Math.max(maxWidth, componentLayout.bounds.width)
    offsetY += componentLayout.bounds.height + COMPONENT_GAP
  }

  return {
    bounds: {
      width: maxWidth,
      height: Math.max(NODE_HEIGHT, offsetY - COMPONENT_GAP),
    },
    positions,
  }
}

function buildChunkGraphMaps(chunk: SynthesisNetlistGraphChunkV1): ChunkGraphMaps {
  const outgoing = new Map<string, string[]>()
  const incoming = new Map<string, string[]>()
  const neighbors = new Map<string, string[]>()
  const incomingCount = new Map<string, number>()

  for (const node of chunk.nodes) {
    outgoing.set(node.id, [])
    incoming.set(node.id, [])
    neighbors.set(node.id, [])
    incomingCount.set(node.id, 0)
  }

  for (const edge of chunk.edges) {
    outgoing.get(edge.source_id)?.push(edge.target_id)
    incoming.get(edge.target_id)?.push(edge.source_id)
    neighbors.get(edge.source_id)?.push(edge.target_id)
    neighbors.get(edge.target_id)?.push(edge.source_id)
    incomingCount.set(edge.target_id, (incomingCount.get(edge.target_id) ?? 0) + 1)
  }

  for (const map of [outgoing, incoming, neighbors]) {
    for (const entries of map.values()) {
      entries.sort()
    }
  }

  return {
    outgoing,
    incoming,
    neighbors,
    incomingCount,
  }
}

function collectConnectedComponents(
  chunk: SynthesisNetlistGraphChunkV1,
  neighbors: Map<string, string[]>,
) {
  const visited = new Set<string>()
  const components: SynthesisNetlistGraphNodeV1[][] = []

  const sortedNodes = [...chunk.nodes].sort(compareNodes)
  for (const seed of sortedNodes) {
    if (visited.has(seed.id)) {
      continue
    }

    const componentIds: string[] = []
    const queue = [seed.id]
    visited.add(seed.id)

    for (let index = 0; index < queue.length; index += 1) {
      const currentId = queue[index]
      componentIds.push(currentId)
      for (const neighborId of neighbors.get(currentId) ?? []) {
        if (visited.has(neighborId)) {
          continue
        }
        visited.add(neighborId)
        queue.push(neighborId)
      }
    }

    const componentNodes = componentIds
      .map((nodeId) => chunk.nodes.find((node) => node.id === nodeId))
      .filter((node): node is SynthesisNetlistGraphNodeV1 => node !== undefined)
      .sort(compareNodes)
    components.push(componentNodes)
  }

  return components
}

function layoutChunkComponent(
  componentNodes: SynthesisNetlistGraphNodeV1[],
  nodeById: Map<string, SynthesisNetlistGraphNodeV1>,
  graphMaps: ChunkGraphMaps,
): NetlistLayoutResult {
  const componentNodeIds = new Set(componentNodes.map((node) => node.id))
  const sourceNodes = componentNodes.filter((node) => {
    return node.kind === 'port' || (graphMaps.incomingCount.get(node.id) ?? 0) === 0
  })
  const hasDirectionalSources = sourceNodes.length > 0
  const seeds = sourceNodes.length > 0 ? sourceNodes : [componentNodes[0]]

  const depthMap = hasDirectionalSources
    ? assignDirectedDepths(seeds, componentNodeIds, graphMaps.outgoing)
    : assignUndirectedDepths(
        seeds[0]?.id ?? componentNodes[0].id,
        componentNodeIds,
        graphMaps.neighbors,
      )

  resolveRemainingDepths(depthMap, componentNodes, componentNodeIds, graphMaps)
  normalizeDepths(depthMap)

  const layeredLayout = buildLayeredLayout(componentNodes, depthMap)
  if (shouldUseCompactGridLayout(componentNodes.length, layeredLayout)) {
    return buildCompactGridLayout(componentNodes, nodeById)
  }

  return layeredLayout
}

function assignDirectedDepths(
  seeds: SynthesisNetlistGraphNodeV1[],
  componentNodeIds: Set<string>,
  outgoing: Map<string, string[]>,
) {
  const depthMap = new Map<string, number>()
  const queue = seeds.map((node) => node.id)

  for (const nodeId of queue) {
    depthMap.set(nodeId, 0)
  }

  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index]
    const baseDepth = depthMap.get(nodeId) ?? 0
    for (const targetId of outgoing.get(nodeId) ?? []) {
      if (!componentNodeIds.has(targetId)) {
        continue
      }

      const nextDepth = baseDepth + 1
      const previousDepth = depthMap.get(targetId)
      if (previousDepth !== undefined && previousDepth >= nextDepth) {
        continue
      }

      depthMap.set(targetId, nextDepth)
      queue.push(targetId)
    }
  }

  return depthMap
}

function assignUndirectedDepths(
  seedId: string,
  componentNodeIds: Set<string>,
  neighbors: Map<string, string[]>,
) {
  const depthMap = new Map<string, number>([[seedId, 0]])
  const queue = [seedId]

  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index]
    const baseDepth = depthMap.get(nodeId) ?? 0
    for (const neighborId of neighbors.get(nodeId) ?? []) {
      if (!componentNodeIds.has(neighborId) || depthMap.has(neighborId)) {
        continue
      }

      depthMap.set(neighborId, baseDepth + 1)
      queue.push(neighborId)
    }
  }

  return depthMap
}

function resolveRemainingDepths(
  depthMap: Map<string, number>,
  componentNodes: SynthesisNetlistGraphNodeV1[],
  componentNodeIds: Set<string>,
  graphMaps: ChunkGraphMaps,
) {
  const unresolved = new Set(
    componentNodes.filter((node) => !depthMap.has(node.id)).map((node) => node.id),
  )

  while (unresolved.size > 0) {
    let progress = false

    for (const nodeId of [...unresolved]) {
      const incomingDepths = (graphMaps.incoming.get(nodeId) ?? [])
        .filter((sourceId) => componentNodeIds.has(sourceId))
        .map((sourceId) => depthMap.get(sourceId))
        .filter((depth): depth is number => depth !== undefined)
      const outgoingDepths = (graphMaps.outgoing.get(nodeId) ?? [])
        .filter((targetId) => componentNodeIds.has(targetId))
        .map((targetId) => depthMap.get(targetId))
        .filter((depth): depth is number => depth !== undefined)
      const neighborDepths = (graphMaps.neighbors.get(nodeId) ?? [])
        .filter((neighborId) => componentNodeIds.has(neighborId))
        .map((neighborId) => depthMap.get(neighborId))
        .filter((depth): depth is number => depth !== undefined)

      if (incomingDepths.length > 0) {
        depthMap.set(nodeId, Math.max(...incomingDepths) + 1)
        unresolved.delete(nodeId)
        progress = true
        continue
      }

      if (outgoingDepths.length > 0) {
        depthMap.set(nodeId, Math.max(0, Math.min(...outgoingDepths) - 1))
        unresolved.delete(nodeId)
        progress = true
        continue
      }

      if (neighborDepths.length > 0) {
        depthMap.set(nodeId, Math.min(...neighborDepths))
        unresolved.delete(nodeId)
        progress = true
      }
    }

    if (progress) {
      continue
    }

    const fallbackNode = componentNodes.find((node) => unresolved.has(node.id))
    if (!fallbackNode) {
      break
    }

    depthMap.set(fallbackNode.id, 0)
    unresolved.delete(fallbackNode.id)
  }
}

function normalizeDepths(depthMap: Map<string, number>) {
  const minDepth = Math.min(...depthMap.values())
  if (!Number.isFinite(minDepth) || minDepth === 0) {
    return
  }

  for (const [nodeId, depth] of depthMap.entries()) {
    depthMap.set(nodeId, depth - minDepth)
  }
}

function buildLayeredLayout(
  componentNodes: SynthesisNetlistGraphNodeV1[],
  depthMap: Map<string, number>,
): NetlistLayoutResult {
  const positions: Record<string, NetlistLayoutRect> = {}
  const columns = new Map<number, SynthesisNetlistGraphNodeV1[]>()

  for (const node of componentNodes) {
    const depth = depthMap.get(node.id) ?? 0
    const bucket = columns.get(depth) ?? []
    bucket.push(node)
    columns.set(depth, bucket)
  }

  const levels = [...columns.keys()].sort((left, right) => left - right)
  let maxRows = 0

  for (const level of levels) {
    const columnNodes = columns.get(level) ?? []
    columnNodes.sort(compareNodes)
    maxRows = Math.max(maxRows, columnNodes.length)
    columnNodes.forEach((node, rowIndex) => {
      positions[node.id] = {
        x: level * (NODE_WIDTH + COLUMN_GAP),
        y: rowIndex * (NODE_HEIGHT + ROW_GAP),
        width: node.kind === 'port' ? PORT_WIDTH : NODE_WIDTH,
        height: NODE_HEIGHT,
      }
    })
  }

  return {
    bounds: {
      width: Math.max(NODE_WIDTH, levels.length * (NODE_WIDTH + COLUMN_GAP) - COLUMN_GAP),
      height: Math.max(NODE_HEIGHT, maxRows * (NODE_HEIGHT + ROW_GAP) - ROW_GAP),
    },
    positions,
  }
}

function shouldUseCompactGridLayout(nodeCount: number, layout: NetlistLayoutResult) {
  if (nodeCount <= 18) {
    return false
  }

  const estimatedColumns = Math.max(
    1,
    Math.round((layout.bounds.width + COLUMN_GAP) / (NODE_WIDTH + COLUMN_GAP)),
  )

  return (
    estimatedColumns > COMPACT_LAYOUT_MAX_COLUMNS ||
    layout.bounds.width > COMPACT_LAYOUT_MAX_WIDTH ||
    layout.bounds.width > layout.bounds.height * 4
  )
}

function buildCompactGridLayout(
  componentNodes: SynthesisNetlistGraphNodeV1[],
  nodeById: Map<string, SynthesisNetlistGraphNodeV1>,
): NetlistLayoutResult {
  const positions: Record<string, NetlistLayoutRect> = {}
  const orderedNodes = [...componentNodes].sort(compareNodes)
  const rowCount = clamp(Math.ceil(Math.sqrt(orderedNodes.length)), 6, 14)
  const columnCount = Math.ceil(orderedNodes.length / rowCount)

  orderedNodes.forEach((node, index) => {
    const columnIndex = Math.floor(index / rowCount)
    const rowIndex = index % rowCount
    const currentNode = nodeById.get(node.id) ?? node

    positions[node.id] = {
      x: columnIndex * (NODE_WIDTH + COLUMN_GAP),
      y: rowIndex * (NODE_HEIGHT + ROW_GAP),
      width: currentNode.kind === 'port' ? PORT_WIDTH : NODE_WIDTH,
      height: NODE_HEIGHT,
    }
  })

  return {
    bounds: {
      width: Math.max(NODE_WIDTH, columnCount * (NODE_WIDTH + COLUMN_GAP) - COLUMN_GAP),
      height: Math.max(
        NODE_HEIGHT,
        Math.min(rowCount, orderedNodes.length) * (NODE_HEIGHT + ROW_GAP) - ROW_GAP,
      ),
    },
    positions,
  }
}

function compareNodes(left: SynthesisNetlistGraphNodeV1, right: SynthesisNetlistGraphNodeV1) {
  return (
    Number(right.kind === 'port') - Number(left.kind === 'port') ||
    right.fanout + right.degree - (left.fanout + left.degree) ||
    left.label.localeCompare(right.label)
  )
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}
