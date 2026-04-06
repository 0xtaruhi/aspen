import { describe, expect, it } from 'vitest'

import type {
  SynthesisNetlistGraphChunkV1,
  SynthesisNetlistGraphNodeV1,
} from '@/lib/hardware-client'

import { computeNetlistChunkLayoutSync } from './netlist-graph-layout-core'

function buildNode(index: number): SynthesisNetlistGraphNodeV1 {
  return {
    id: `cell:n${index}`,
    label: `n${index}`,
    kind: 'cell',
    cell_type: 'LUT4',
    direction: null,
    degree: 2,
    fanin: 1,
    fanout: 1,
    external_connection_count: 0,
    properties: [],
    truth_table: null,
  }
}

describe('netlist graph layout core', () => {
  it('keeps cycle-heavy focused views compact enough to fit on the canvas', () => {
    const nodes = Array.from({ length: 48 }, (_, index) => buildNode(index))
    const chunk: SynthesisNetlistGraphChunkV1 = {
      version: 1,
      top_module: 'top',
      cache_dir: '/tmp/netlist-graph',
      graph_format: 'msgpack-v1',
      chunk_id: 'chunk-0001',
      node_count: nodes.length,
      edge_count: nodes.length,
      nodes,
      edges: nodes.map((node, index) => ({
        id: `edge-${index}`,
        source_id: node.id,
        target_id: nodes[(index + 1) % nodes.length].id,
        signal: `sig_${index}`,
        bit_width: 1,
      })),
      linked_chunks: [],
    }

    const layout = computeNetlistChunkLayoutSync(chunk)

    expect(Object.keys(layout.positions)).toHaveLength(nodes.length)
    expect(layout.bounds.width).toBeLessThan(2500)
    expect(layout.bounds.height).toBeGreaterThan(300)
  })

  it('stacks disconnected components vertically instead of stretching the whole view', () => {
    const nodes = Array.from({ length: 12 }, (_, index) => buildNode(index))
    const chunk: SynthesisNetlistGraphChunkV1 = {
      version: 1,
      top_module: 'top',
      cache_dir: '/tmp/netlist-graph',
      graph_format: 'msgpack-v1',
      chunk_id: 'chunk-0002',
      node_count: nodes.length,
      edge_count: 8,
      nodes,
      edges: [
        { id: 'a0', source_id: nodes[0].id, target_id: nodes[1].id, signal: 'a0', bit_width: 1 },
        { id: 'a1', source_id: nodes[1].id, target_id: nodes[2].id, signal: 'a1', bit_width: 1 },
        { id: 'a2', source_id: nodes[2].id, target_id: nodes[3].id, signal: 'a2', bit_width: 1 },
        { id: 'a3', source_id: nodes[3].id, target_id: nodes[4].id, signal: 'a3', bit_width: 1 },
        { id: 'b0', source_id: nodes[6].id, target_id: nodes[7].id, signal: 'b0', bit_width: 1 },
        { id: 'b1', source_id: nodes[7].id, target_id: nodes[8].id, signal: 'b1', bit_width: 1 },
        { id: 'b2', source_id: nodes[8].id, target_id: nodes[9].id, signal: 'b2', bit_width: 1 },
        { id: 'b3', source_id: nodes[9].id, target_id: nodes[10].id, signal: 'b3', bit_width: 1 },
      ],
      linked_chunks: [],
    }

    const layout = computeNetlistChunkLayoutSync(chunk)
    const upperComponentBottom = Math.max(
      ...[nodes[0], nodes[1], nodes[2], nodes[3], nodes[4]].map(
        (node) => layout.positions[node.id].y + layout.positions[node.id].height,
      ),
    )
    const lowerComponentTop = Math.min(
      ...[nodes[6], nodes[7], nodes[8], nodes[9], nodes[10]].map(
        (node) => layout.positions[node.id].y,
      ),
    )

    expect(lowerComponentTop).toBeGreaterThan(upperComponentBottom)
    expect(layout.bounds.width).toBeLessThan(1800)
  })
})
