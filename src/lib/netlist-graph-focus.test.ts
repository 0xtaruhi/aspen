import { describe, expect, it } from 'vitest'

import type { SynthesisNetlistGraphChunkV1 } from '@/lib/hardware-client'

import { computeNetlistFocus } from './netlist-graph-focus'

const chunk: SynthesisNetlistGraphChunkV1 = {
  version: 1,
  top_module: 'top',
  cache_dir: '/tmp/netlist-graph',
  graph_format: 'msgpack-v3',
  chunk_id: 'chunk-0000',
  node_count: 5,
  edge_count: 4,
  nodes: [
    {
      id: 'a',
      label: 'a',
      kind: 'port',
      cell_type: null,
      direction: 'input',
      degree: 1,
      fanin: 0,
      fanout: 1,
      external_connection_count: 0,
      properties: [],
      truth_table: null,
    },
    {
      id: 'b',
      label: 'b',
      kind: 'cell',
      cell_type: 'LUT4',
      direction: null,
      degree: 2,
      fanin: 1,
      fanout: 1,
      external_connection_count: 0,
      properties: [],
      truth_table: null,
    },
    {
      id: 'c',
      label: 'c',
      kind: 'cell',
      cell_type: 'LUT4',
      direction: null,
      degree: 3,
      fanin: 2,
      fanout: 1,
      external_connection_count: 0,
      properties: [],
      truth_table: null,
    },
    {
      id: 'd',
      label: 'd',
      kind: 'cell',
      cell_type: 'DFFRHQ',
      direction: null,
      degree: 1,
      fanin: 1,
      fanout: 0,
      external_connection_count: 0,
      properties: [],
      truth_table: null,
    },
    {
      id: 'e',
      label: 'e',
      kind: 'cell',
      cell_type: 'LUT4',
      direction: null,
      degree: 1,
      fanin: 0,
      fanout: 1,
      external_connection_count: 0,
      properties: [],
      truth_table: null,
    },
  ],
  edges: [
    { id: 'ab', source_id: 'a', target_id: 'b', signal: 'ab', bit_width: 1 },
    { id: 'bc', source_id: 'b', target_id: 'c', signal: 'bc', bit_width: 1 },
    { id: 'ec', source_id: 'e', target_id: 'c', signal: 'ec', bit_width: 1 },
    { id: 'cd', source_id: 'c', target_id: 'd', signal: 'cd', bit_width: 1 },
  ],
  linked_chunks: [],
}

describe('netlist graph focus', () => {
  it('computes fanin and fanout cones from the selected node', () => {
    const fanin = computeNetlistFocus(chunk, 'c', 'fanin')
    const fanout = computeNetlistFocus(chunk, 'c', 'fanout')

    expect([...fanin.nodeIds].sort()).toEqual(['a', 'b', 'c', 'e'])
    expect([...fanin.upstreamEdgeIds].sort()).toEqual(['ab', 'bc', 'ec'])
    expect([...fanout.nodeIds].sort()).toEqual(['c', 'd'])
    expect([...fanout.downstreamEdgeIds].sort()).toEqual(['cd'])
  })

  it('returns the full graph when no scoped traversal is requested', () => {
    const focus = computeNetlistFocus(chunk, 'c', 'full')

    expect(focus.nodeIds.size).toBe(chunk.nodes.length)
    expect(focus.edgeIds.size).toBe(chunk.edges.length)
    expect(focus.upstreamNodeIds.size).toBe(0)
    expect(focus.downstreamNodeIds.size).toBe(0)
  })
})
