use std::{
    cmp::Reverse,
    collections::{BTreeMap, BTreeSet, HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;

use crate::hardware::types::{
    SynthesisNetlistGraphChunkSummaryV1, SynthesisNetlistGraphChunkV1, SynthesisNetlistGraphEdgeV1,
    SynthesisNetlistGraphInterconnectV1, SynthesisNetlistGraphLinkedChunkV1,
    SynthesisNetlistGraphNodePropertyV1, SynthesisNetlistGraphNodeV1,
    SynthesisNetlistGraphOverviewV1, SynthesisNetlistGraphPortViewV1,
    SynthesisNetlistGraphSearchMatchV1, SynthesisNetlistGraphSearchResultV1, SynthesisTopPortV1,
};

const GRAPH_CACHE_VERSION: u8 = 1;
const GRAPH_CACHE_FORMAT: &str = "msgpack-v4";
const CHUNK_TARGET_NODE_COUNT: usize = 160;
const DEFAULT_SEARCH_LIMIT: usize = 18;
const MAX_PROMINENT_LABELS: usize = 4;
const MAX_PROMINENT_SIGNALS: usize = 5;

#[derive(Debug, Clone)]
struct GraphNodeRecord {
    id: String,
    label: String,
    kind: String,
    cell_type: Option<String>,
    direction: Option<String>,
    properties: Vec<SynthesisNetlistGraphNodePropertyV1>,
    truth_table: Option<String>,
}

#[derive(Debug, Clone)]
struct GraphEdgeRecord {
    source: usize,
    target: usize,
    signal: String,
    bit_width: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SearchRecord {
    kind: String,
    label: String,
    normalized_label: String,
    detail: String,
    chunk_id: String,
    node_id: Option<String>,
}

#[derive(Debug, Clone)]
struct SearchCandidate {
    kind: String,
    label: String,
    detail: String,
    node_index: Option<usize>,
    aliases: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct ChunkCache {
    version: u8,
    top_module: String,
    cache_dir: String,
    graph_format: String,
    chunk_id: String,
    node_count: u32,
    edge_count: u32,
    nodes: Vec<SynthesisNetlistGraphNodeV1>,
    edges: Vec<SynthesisNetlistGraphEdgeV1>,
    linked_chunks: Vec<SynthesisNetlistGraphLinkedChunkV1>,
}

pub(super) fn build_or_load_netlist_graph_cache(
    top_module: &str,
    netlist_path: &Path,
    cache_dir: &Path,
    top_ports: &[SynthesisTopPortV1],
) -> Result<SynthesisNetlistGraphOverviewV1, String> {
    let overview_path = overview_path(cache_dir);
    if let Ok(cached) = read_msgpack_file::<SynthesisNetlistGraphOverviewV1>(&overview_path) {
        if cached.version == GRAPH_CACHE_VERSION
            && cached.graph_format == GRAPH_CACHE_FORMAT
            && cached.top_module == top_module
        {
            return Ok(cached);
        }
    }

    build_netlist_graph_cache(top_module, netlist_path, cache_dir, top_ports)
}

pub(super) fn load_netlist_graph_chunk(
    cache_dir: &Path,
    chunk_id: &str,
) -> Result<SynthesisNetlistGraphChunkV1, String> {
    let path = chunk_path(cache_dir, chunk_id);
    let chunk = read_msgpack_file::<ChunkCache>(&path)?;
    Ok(SynthesisNetlistGraphChunkV1 {
        version: chunk.version,
        top_module: chunk.top_module,
        cache_dir: chunk.cache_dir,
        graph_format: chunk.graph_format,
        chunk_id: chunk.chunk_id,
        node_count: chunk.node_count,
        edge_count: chunk.edge_count,
        nodes: chunk.nodes,
        edges: chunk.edges,
        linked_chunks: chunk.linked_chunks,
    })
}

pub(super) fn search_netlist_graph(
    cache_dir: &Path,
    query: &str,
    limit: usize,
) -> Result<SynthesisNetlistGraphSearchResultV1, String> {
    let normalized_query = normalize_query(query);
    if normalized_query.is_empty() {
        return Ok(SynthesisNetlistGraphSearchResultV1 {
            version: GRAPH_CACHE_VERSION,
            query: query.to_string(),
            matches: Vec::new(),
        });
    }

    let records = read_msgpack_file::<Vec<SearchRecord>>(&search_path(cache_dir))?;
    let capped_limit = if limit == 0 {
        DEFAULT_SEARCH_LIMIT
    } else {
        limit.min(64)
    };
    let mut scored_matches = records
        .into_iter()
        .filter_map(|record| {
            let position = record.normalized_label.find(&normalized_query)?;
            let starts_with = position == 0;
            let exact = record.normalized_label == normalized_query;
            let score = (
                !exact,
                !starts_with,
                position,
                record.label.len(),
                record.kind.clone(),
                record.label.clone(),
            );

            Some((score, record))
        })
        .collect::<Vec<_>>();

    scored_matches.sort_by(|left, right| left.0.cmp(&right.0));
    scored_matches.truncate(capped_limit);

    Ok(SynthesisNetlistGraphSearchResultV1 {
        version: GRAPH_CACHE_VERSION,
        query: query.to_string(),
        matches: scored_matches
            .into_iter()
            .map(|(_, record)| SynthesisNetlistGraphSearchMatchV1 {
                kind: record.kind,
                label: record.label,
                detail: record.detail,
                chunk_id: record.chunk_id,
                node_id: record.node_id,
            })
            .collect(),
    })
}

fn build_netlist_graph_cache(
    top_module: &str,
    netlist_path: &Path,
    cache_dir: &Path,
    top_ports: &[SynthesisTopPortV1],
) -> Result<SynthesisNetlistGraphOverviewV1, String> {
    let netlist = fs::read_to_string(netlist_path).map_err(|err| err.to_string())?;
    let json: Value = serde_json::from_str(&netlist).map_err(|err| err.to_string())?;
    let top = json
        .get("modules")
        .and_then(Value::as_object)
        .and_then(|modules| modules.get(top_module))
        .ok_or_else(|| {
            format!(
                "Top module '{}' not found in synthesized netlist",
                top_module
            )
        })?;

    let ports = top
        .get("ports")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let cells = top
        .get("cells")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let netnames = top
        .get("netnames")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let mut nodes = Vec::<GraphNodeRecord>::new();
    let mut port_node_ids = Vec::<usize>::new();
    let mut top_port_nodes = Vec::<(String, String, String, usize)>::new();
    let mut bit_signal_names = HashMap::<u32, (bool, String)>::new();
    let mut drivers_by_bit = HashMap::<u32, Vec<usize>>::new();
    let mut sinks_by_bit = HashMap::<u32, Vec<usize>>::new();
    let mut search_candidates = Vec::<SearchCandidate>::new();
    let mut internal_cell_counter = 0_u32;

    for (name, net) in &netnames {
        let is_public = !name.starts_with('$');
        for bit in extract_numeric_bits(net.get("bits").unwrap_or(&Value::Null)) {
            let candidate = (is_public, name.clone());
            match bit_signal_names.get(&bit) {
                Some((existing_public, _)) if *existing_public && !is_public => {}
                Some((existing_public, existing_name))
                    if *existing_public == is_public && existing_name.len() <= name.len() => {}
                _ => {
                    bit_signal_names.insert(bit, candidate.clone());
                }
            }
        }
    }

    let mut sorted_port_names = ports.keys().cloned().collect::<Vec<_>>();
    sorted_port_names.sort();
    for name in sorted_port_names {
        let Some(port) = ports.get(&name) else {
            continue;
        };
        let direction = port
            .get("direction")
            .and_then(Value::as_str)
            .unwrap_or("input")
            .to_string();
        let node_index = nodes.len();
        nodes.push(GraphNodeRecord {
            id: format!("port:{name}"),
            label: name.clone(),
            kind: "port".to_string(),
            cell_type: None,
            direction: Some(direction.clone()),
            properties: Vec::new(),
            truth_table: None,
        });
        port_node_ids.push(node_index);
        let port_width = top_ports
            .iter()
            .find(|port| port.name == name)
            .map(|port| port.width.clone())
            .unwrap_or_default();
        top_port_nodes.push((name.clone(), direction.clone(), port_width, node_index));
        search_candidates.push(SearchCandidate {
            kind: "port".to_string(),
            label: name.clone(),
            detail: format!("{} port", direction),
            node_index: Some(node_index),
            aliases: build_search_aliases(&name, top_module),
        });

        for bit in extract_numeric_bits(port.get("bits").unwrap_or(&Value::Null)) {
            match direction.as_str() {
                "input" => drivers_by_bit.entry(bit).or_default().push(node_index),
                "output" => sinks_by_bit.entry(bit).or_default().push(node_index),
                "inout" => {
                    drivers_by_bit.entry(bit).or_default().push(node_index);
                    sinks_by_bit.entry(bit).or_default().push(node_index);
                }
                _ => {}
            }
        }
    }

    let mut sorted_cell_names = cells.keys().cloned().collect::<Vec<_>>();
    sorted_cell_names.sort();
    for cell_name in sorted_cell_names {
        let Some(cell) = cells.get(&cell_name) else {
            continue;
        };
        let cell_type = cell
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("$unknown")
            .to_string();
        if is_metadata_cell_type(&cell_type) {
            continue;
        }

        let label = if cell_name.starts_with('$') {
            internal_cell_counter = internal_cell_counter.saturating_add(1);
            format!("{} {}", cell_type, internal_cell_counter)
        } else {
            cell_name.clone()
        };
        let (properties, truth_table) = extract_cell_properties(cell, &cell_type);
        let node_index = nodes.len();
        nodes.push(GraphNodeRecord {
            id: format!("cell:{cell_name}"),
            label: label.clone(),
            kind: "cell".to_string(),
            cell_type: Some(cell_type.clone()),
            direction: None,
            properties,
            truth_table,
        });
        let mut aliases = build_search_aliases(&label, top_module);
        aliases.extend(build_search_aliases(&cell_name, top_module));
        search_candidates.push(SearchCandidate {
            kind: "cell".to_string(),
            label: label.clone(),
            detail: cell_type.clone(),
            node_index: Some(node_index),
            aliases: dedupe_aliases(aliases),
        });

        let port_directions = cell
            .get("port_directions")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();
        let connections = cell
            .get("connections")
            .and_then(Value::as_object)
            .cloned()
            .unwrap_or_default();

        for (port_name, connection) in connections {
            let direction = port_directions
                .get(&port_name)
                .and_then(Value::as_str)
                .unwrap_or("input");
            for bit in extract_numeric_bits(&connection) {
                match direction {
                    "output" => drivers_by_bit.entry(bit).or_default().push(node_index),
                    "input" => sinks_by_bit.entry(bit).or_default().push(node_index),
                    "inout" => {
                        drivers_by_bit.entry(bit).or_default().push(node_index);
                        sinks_by_bit.entry(bit).or_default().push(node_index);
                    }
                    _ => {}
                }
            }
        }
    }

    let mut edge_map = BTreeMap::<(usize, usize, String), u16>::new();
    let mut signal_chunk_seed_map = BTreeMap::<String, BTreeSet<usize>>::new();
    let mut named_signal_set = BTreeSet::<String>::new();

    for (bit, sinks) in &sinks_by_bit {
        let Some(drivers) = drivers_by_bit.get(bit) else {
            continue;
        };

        let mut deduped_drivers = drivers.clone();
        deduped_drivers.sort_unstable();
        deduped_drivers.dedup();
        let mut deduped_sinks = sinks.clone();
        deduped_sinks.sort_unstable();
        deduped_sinks.dedup();

        let signal_name = bit_signal_names
            .get(bit)
            .map(|(_, name)| name.clone())
            .unwrap_or_else(|| format!("bit_{bit}"));
        if !signal_name.starts_with('$') && !signal_name.starts_with("bit_") {
            named_signal_set.insert(signal_name.clone());
        }

        for source in &deduped_drivers {
            for target in &deduped_sinks {
                if source == target {
                    continue;
                }
                let entry = edge_map
                    .entry((*source, *target, signal_name.clone()))
                    .or_insert(0);
                *entry = entry.saturating_add(1);
                signal_chunk_seed_map
                    .entry(signal_name.clone())
                    .or_default()
                    .insert(*source);
                signal_chunk_seed_map
                    .entry(signal_name.clone())
                    .or_default()
                    .insert(*target);
            }
        }
    }

    let edges = edge_map
        .into_iter()
        .map(|((source, target, signal), bit_width)| GraphEdgeRecord {
            source,
            target,
            signal,
            bit_width,
        })
        .collect::<Vec<_>>();

    let mut adjacency = vec![Vec::<usize>::new(); nodes.len()];
    let mut indegree = vec![0_u32; nodes.len()];
    let mut outdegree = vec![0_u32; nodes.len()];
    for edge in &edges {
        adjacency[edge.source].push(edge.target);
        adjacency[edge.target].push(edge.source);
        outdegree[edge.source] = outdegree[edge.source].saturating_add(1);
        indegree[edge.target] = indegree[edge.target].saturating_add(1);
    }
    let adjacency_degree_ranks = adjacency.iter().map(Vec::len).collect::<Vec<_>>();
    for neighbors in &mut adjacency {
        neighbors.sort_unstable();
        neighbors.dedup();
        neighbors.sort_by_key(|neighbor| Reverse(adjacency_degree_ranks[*neighbor]));
    }

    let node_to_chunk_index = assign_chunks(&nodes, &port_node_ids, &adjacency);
    let chunk_count = node_to_chunk_index
        .iter()
        .copied()
        .max()
        .map(|max| max + 1)
        .unwrap_or(0);
    let chunk_ids = (0..chunk_count)
        .map(|index| format!("chunk-{index:04}"))
        .collect::<Vec<_>>();
    let top_port_views = top_port_nodes
        .into_iter()
        .map(
            |(name, direction, width, node_index)| SynthesisNetlistGraphPortViewV1 {
                name,
                direction,
                width,
                chunk_id: chunk_ids[node_to_chunk_index[node_index]].clone(),
            },
        )
        .collect::<Vec<_>>();
    let mut nodes_by_chunk = vec![Vec::<usize>::new(); chunk_count];
    for (node_index, chunk_index) in node_to_chunk_index.iter().copied().enumerate() {
        nodes_by_chunk[chunk_index].push(node_index);
    }

    let mut internal_edge_counts = vec![0_u32; chunk_count];
    let mut external_edge_counts = vec![0_u32; chunk_count];
    let mut interconnect_map = BTreeMap::<(usize, usize), u32>::new();
    let mut chunk_signal_map = HashMap::<(usize, usize), BTreeMap<String, u32>>::new();
    let mut node_external_counts = vec![0_u32; nodes.len()];

    for edge in &edges {
        let source_chunk = node_to_chunk_index[edge.source];
        let target_chunk = node_to_chunk_index[edge.target];
        if source_chunk == target_chunk {
            internal_edge_counts[source_chunk] =
                internal_edge_counts[source_chunk].saturating_add(1);
            continue;
        }

        external_edge_counts[source_chunk] = external_edge_counts[source_chunk].saturating_add(1);
        external_edge_counts[target_chunk] = external_edge_counts[target_chunk].saturating_add(1);
        node_external_counts[edge.source] = node_external_counts[edge.source].saturating_add(1);
        node_external_counts[edge.target] = node_external_counts[edge.target].saturating_add(1);

        let pair = if source_chunk < target_chunk {
            (source_chunk, target_chunk)
        } else {
            (target_chunk, source_chunk)
        };
        *interconnect_map.entry(pair).or_default() += 1;
        *chunk_signal_map
            .entry((source_chunk, target_chunk))
            .or_default()
            .entry(edge.signal.clone())
            .or_default() += 1;
        *chunk_signal_map
            .entry((target_chunk, source_chunk))
            .or_default()
            .entry(edge.signal.clone())
            .or_default() += 1;
    }

    let cache_dir_string = cache_dir.to_string_lossy().to_string();
    fs::create_dir_all(chunks_dir(cache_dir)).map_err(|err| err.to_string())?;

    let mut search_index = Vec::<SearchRecord>::new();
    let mut search_index_keys = BTreeSet::<(String, String, Option<String>)>::new();
    for candidate in search_candidates {
        let chunk_id = candidate
            .node_index
            .map(|index| chunk_ids[node_to_chunk_index[index]].clone())
            .unwrap_or_else(|| chunk_ids.first().cloned().unwrap_or_default());
        let node_id = candidate.node_index.map(|index| nodes[index].id.clone());
        for alias in candidate.aliases {
            let normalized_label = normalize_query(&alias);
            if normalized_label.is_empty() {
                continue;
            }

            let dedupe_key = (
                candidate.kind.clone(),
                normalized_label.clone(),
                node_id.clone(),
            );
            if !search_index_keys.insert(dedupe_key) {
                continue;
            }

            search_index.push(SearchRecord {
                kind: candidate.kind.clone(),
                label: candidate.label.clone(),
                normalized_label,
                detail: candidate.detail.clone(),
                chunk_id: chunk_id.clone(),
                node_id: node_id.clone(),
            });
        }
    }

    for (signal_name, node_indexes) in signal_chunk_seed_map {
        if signal_name.starts_with('$') || signal_name.starts_with("bit_") {
            continue;
        }
        let Some(first_node_index) = node_indexes.iter().next().copied() else {
            continue;
        };
        for alias in build_search_aliases(&signal_name, top_module) {
            let normalized_label = normalize_query(&alias);
            let dedupe_key = ("signal".to_string(), normalized_label.clone(), None);
            if !search_index_keys.insert(dedupe_key) {
                continue;
            }

            search_index.push(SearchRecord {
                kind: "signal".to_string(),
                label: signal_name.clone(),
                normalized_label,
                detail: "signal".to_string(),
                chunk_id: chunk_ids[node_to_chunk_index[first_node_index]].clone(),
                node_id: None,
            });
        }
    }

    let mut chunk_summaries = Vec::<SynthesisNetlistGraphChunkSummaryV1>::new();
    for (chunk_index, node_indexes) in nodes_by_chunk.iter().enumerate() {
        let mut cell_type_counts = BTreeMap::<String, u32>::new();
        let mut prominent_labels = Vec::<String>::new();
        let mut port_count = 0_u32;
        let mut max_fanout = 0_u32;
        let node_id_set = node_indexes.iter().copied().collect::<BTreeSet<_>>();

        let mut chunk_nodes = node_indexes
            .iter()
            .map(|node_index| {
                let node = &nodes[*node_index];
                let degree = indegree[*node_index].saturating_add(outdegree[*node_index]);
                max_fanout = max_fanout.max(outdegree[*node_index]);
                if node.kind == "port" {
                    port_count = port_count.saturating_add(1);
                    prominent_labels.push(node.label.clone());
                }
                if let Some(cell_type) = &node.cell_type {
                    *cell_type_counts.entry(cell_type.clone()).or_default() += 1;
                }

                SynthesisNetlistGraphNodeV1 {
                    id: node.id.clone(),
                    label: node.label.clone(),
                    kind: node.kind.clone(),
                    cell_type: node.cell_type.clone(),
                    direction: node.direction.clone(),
                    degree,
                    fanin: indegree[*node_index],
                    fanout: outdegree[*node_index],
                    external_connection_count: node_external_counts[*node_index],
                    properties: node.properties.clone(),
                    truth_table: node.truth_table.clone(),
                }
            })
            .collect::<Vec<_>>();
        chunk_nodes.sort_by(|left, right| {
            left.kind
                .cmp(&right.kind)
                .then_with(|| left.label.cmp(&right.label))
        });

        let mut chunk_edges = Vec::<SynthesisNetlistGraphEdgeV1>::new();
        for edge in &edges {
            if node_id_set.contains(&edge.source) && node_id_set.contains(&edge.target) {
                chunk_edges.push(SynthesisNetlistGraphEdgeV1 {
                    id: format!(
                        "{}:{}:{}:{}",
                        chunk_ids[chunk_index],
                        nodes[edge.source].id,
                        nodes[edge.target].id,
                        edge.signal
                    ),
                    source_id: nodes[edge.source].id.clone(),
                    target_id: nodes[edge.target].id.clone(),
                    signal: edge.signal.clone(),
                    bit_width: edge.bit_width,
                });
            }
        }
        chunk_edges.sort_by(|left, right| left.id.cmp(&right.id));

        let mut linked_chunks = chunk_signal_map
            .iter()
            .filter(|((source_chunk, _), _)| *source_chunk == chunk_index)
            .map(|((_, target_chunk), signals)| {
                let mut sorted_signals = signals.iter().collect::<Vec<_>>();
                sorted_signals
                    .sort_by(|left, right| right.1.cmp(left.1).then_with(|| left.0.cmp(right.0)));
                let prominent_signals = sorted_signals
                    .into_iter()
                    .take(MAX_PROMINENT_SIGNALS)
                    .map(|(signal, _)| signal.clone())
                    .collect::<Vec<_>>();
                let edge_count = interconnect_map
                    .get(&(
                        chunk_index.min(*target_chunk),
                        chunk_index.max(*target_chunk),
                    ))
                    .copied()
                    .unwrap_or(0);

                SynthesisNetlistGraphLinkedChunkV1 {
                    chunk_id: chunk_ids[*target_chunk].clone(),
                    edge_count,
                    prominent_signals,
                }
            })
            .collect::<Vec<_>>();
        linked_chunks.sort_by(|left, right| {
            right
                .edge_count
                .cmp(&left.edge_count)
                .then_with(|| left.chunk_id.cmp(&right.chunk_id))
        });

        let mut prominent_from_types = cell_type_counts.into_iter().collect::<Vec<_>>();
        prominent_from_types
            .sort_by(|left, right| right.1.cmp(&left.1).then_with(|| left.0.cmp(&right.0)));
        prominent_labels.extend(
            prominent_from_types
                .into_iter()
                .map(|(cell_type, count)| format!("{} x{}", cell_type, count))
                .take(MAX_PROMINENT_LABELS),
        );
        prominent_labels.sort();
        prominent_labels.dedup();
        prominent_labels.truncate(MAX_PROMINENT_LABELS);

        let chunk_id = chunk_ids[chunk_index].clone();
        let chunk = ChunkCache {
            version: GRAPH_CACHE_VERSION,
            top_module: top_module.to_string(),
            cache_dir: cache_dir_string.clone(),
            graph_format: GRAPH_CACHE_FORMAT.to_string(),
            chunk_id: chunk_id.clone(),
            node_count: chunk_nodes.len().min(u32::MAX as usize) as u32,
            edge_count: chunk_edges.len().min(u32::MAX as usize) as u32,
            nodes: chunk_nodes,
            edges: chunk_edges,
            linked_chunks,
        };
        write_msgpack_file(&chunk_path(cache_dir, &chunk_id), &chunk)?;

        chunk_summaries.push(SynthesisNetlistGraphChunkSummaryV1 {
            chunk_id,
            node_count: node_indexes.len().min(u32::MAX as usize) as u32,
            edge_count: internal_edge_counts[chunk_index],
            external_edge_count: external_edge_counts[chunk_index],
            port_count,
            cell_count: node_indexes
                .iter()
                .filter(|node_index| nodes[**node_index].kind == "cell")
                .count()
                .min(u32::MAX as usize) as u32,
            max_fanout,
            prominent_labels,
        });
    }

    let mut interconnects = interconnect_map
        .into_iter()
        .map(
            |((source_chunk, target_chunk), edge_count)| SynthesisNetlistGraphInterconnectV1 {
                source_chunk_id: chunk_ids[source_chunk].clone(),
                target_chunk_id: chunk_ids[target_chunk].clone(),
                edge_count,
            },
        )
        .collect::<Vec<_>>();
    interconnects.sort_by(|left, right| {
        right
            .edge_count
            .cmp(&left.edge_count)
            .then_with(|| left.source_chunk_id.cmp(&right.source_chunk_id))
            .then_with(|| left.target_chunk_id.cmp(&right.target_chunk_id))
    });
    chunk_summaries.sort_by(|left, right| left.chunk_id.cmp(&right.chunk_id));

    let overview = SynthesisNetlistGraphOverviewV1 {
        version: GRAPH_CACHE_VERSION,
        top_module: top_module.to_string(),
        cache_dir: cache_dir_string,
        graph_format: GRAPH_CACHE_FORMAT.to_string(),
        node_count: nodes.len().min(u32::MAX as usize) as u32,
        edge_count: edges.len().min(u32::MAX as usize) as u32,
        named_signal_count: named_signal_set.len().min(u32::MAX as usize) as u32,
        chunk_target_node_count: CHUNK_TARGET_NODE_COUNT as u32,
        chunks: chunk_summaries,
        interconnects,
        top_ports: top_ports.to_vec(),
        top_port_views,
    };

    write_msgpack_file(&overview_path(cache_dir), &overview)?;
    write_msgpack_file(&search_path(cache_dir), &search_index)?;

    Ok(overview)
}

fn assign_chunks(
    nodes: &[GraphNodeRecord],
    port_node_ids: &[usize],
    adjacency: &[Vec<usize>],
) -> Vec<usize> {
    let mut node_to_chunk_index = vec![usize::MAX; nodes.len()];
    let mut chunk_index = 0_usize;

    let mut seed_order = port_node_ids.to_vec();
    let mut remaining = (0..nodes.len())
        .filter(|node_index| !port_node_ids.contains(node_index))
        .collect::<Vec<_>>();
    remaining.sort_by_key(|node_index| {
        (
            Reverse(adjacency.get(*node_index).map(Vec::len).unwrap_or(0)),
            nodes[*node_index].label.clone(),
        )
    });
    seed_order.extend(remaining);

    for seed in seed_order {
        if node_to_chunk_index[seed] != usize::MAX {
            continue;
        }

        let mut queue = VecDeque::from([seed]);
        let mut assigned = 0_usize;
        while let Some(node_index) = queue.pop_front() {
            if node_to_chunk_index[node_index] != usize::MAX {
                continue;
            }

            node_to_chunk_index[node_index] = chunk_index;
            assigned += 1;
            if assigned >= CHUNK_TARGET_NODE_COUNT {
                break;
            }

            for neighbor in &adjacency[node_index] {
                if node_to_chunk_index[*neighbor] == usize::MAX {
                    queue.push_back(*neighbor);
                }
            }
        }

        chunk_index += 1;
    }

    for node_index in 0..node_to_chunk_index.len() {
        if node_to_chunk_index[node_index] == usize::MAX {
            node_to_chunk_index[node_index] = chunk_index;
            chunk_index += 1;
        }
    }

    node_to_chunk_index
}

fn extract_cell_properties(
    cell: &Value,
    cell_type: &str,
) -> (Vec<SynthesisNetlistGraphNodePropertyV1>, Option<String>) {
    let parameters = cell
        .get("parameters")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let mut properties = parameters
        .into_iter()
        .filter_map(|(key, value)| {
            format_property_value(&value).map(|formatted| SynthesisNetlistGraphNodePropertyV1 {
                key,
                value: formatted,
            })
        })
        .collect::<Vec<_>>();
    properties.sort_by(|left, right| left.key.cmp(&right.key));

    let truth_table = properties
        .iter()
        .find(|property| is_truth_table_property(cell_type, &property.key))
        .map(|property| format_truth_table_value(&property.value));

    (properties, truth_table)
}

fn format_property_value(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::String(string) => Some(string.clone()),
        Value::Number(number) => Some(number.to_string()),
        Value::Bool(boolean) => Some(boolean.to_string()),
        Value::Array(values) => {
            let formatted = values
                .iter()
                .filter_map(format_property_value)
                .collect::<Vec<_>>();
            if formatted.is_empty() {
                None
            } else {
                Some(formatted.join(", "))
            }
        }
        Value::Object(object) => Some(
            object
                .iter()
                .filter_map(|(key, nested)| {
                    format_property_value(nested).map(|formatted| format!("{key}: {formatted}"))
                })
                .collect::<Vec<_>>()
                .join(", "),
        ),
    }
}

fn is_truth_table_property(cell_type: &str, property_key: &str) -> bool {
    let normalized_key = property_key.to_ascii_uppercase();
    if normalized_key.contains("TRUTH") {
        return true;
    }

    normalized_key == "INIT" && cell_type.to_ascii_uppercase().contains("LUT")
}

fn format_truth_table_value(value: &str) -> String {
    if value.is_empty() {
        return value.to_string();
    }

    let normalized = value.trim();
    if !normalized
        .chars()
        .all(|character| matches!(character, '0' | '1' | 'x' | 'X' | 'z' | 'Z'))
    {
        return normalized.to_string();
    }

    let grouped_binary = normalized
        .chars()
        .collect::<Vec<_>>()
        .chunks(4)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect::<Vec<_>>()
        .join("_");

    if let Some(hex_value) = binary_to_hex_string(normalized) {
        return format!("0b{grouped_binary} / 0x{hex_value}");
    }

    format!("0b{grouped_binary}")
}

fn binary_to_hex_string(bits: &str) -> Option<String> {
    if bits.is_empty() || !bits.chars().all(|character| matches!(character, '0' | '1')) {
        return None;
    }

    let padding = (4 - bits.len() % 4) % 4;
    let mut padded = String::with_capacity(bits.len() + padding);
    padded.extend(std::iter::repeat('0').take(padding));
    padded.push_str(bits);

    let mut hex = String::with_capacity(padded.len() / 4);
    for chunk in padded.as_bytes().chunks(4) {
        let mut nibble = 0_u8;
        for bit in chunk {
            nibble = (nibble << 1)
                | match bit {
                    b'0' => 0,
                    b'1' => 1,
                    _ => return None,
                };
        }
        hex.push(char::from_digit(u32::from(nibble), 16)?.to_ascii_uppercase());
    }

    let trimmed = hex.trim_start_matches('0');
    if trimmed.is_empty() {
        Some("0".to_string())
    } else {
        Some(trimmed.to_string())
    }
}

fn extract_numeric_bits(value: &Value) -> Vec<u32> {
    value
        .as_array()
        .map(|bits| {
            bits.iter()
                .filter_map(|bit| match bit {
                    Value::Number(number) => {
                        number.as_u64().and_then(|value| u32::try_from(value).ok())
                    }
                    _ => None,
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default()
}

fn is_metadata_cell_type(cell_type: &str) -> bool {
    matches!(cell_type, "$scopeinfo" | "$meminit" | "$specify2")
}

fn normalize_query(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn build_search_aliases(value: &str, top_module: &str) -> Vec<String> {
    let mut aliases = vec![value.trim().to_string()];
    let trimmed = value.trim();

    if let Some(stripped) = trimmed.strip_prefix('\\') {
        aliases.push(stripped.to_string());
    }

    for separator in ["/", "."] {
        let prefix = format!("{top_module}{separator}");
        if let Some(stripped) = trimmed.strip_prefix(&prefix) {
            aliases.push(stripped.to_string());
        }

        if let Some(last_segment) = trimmed.rsplit(separator).next() {
            aliases.push(last_segment.to_string());
        }
    }

    if let Some(index) = trimmed.find('[') {
        aliases.push(trimmed[..index].to_string());
    }

    dedupe_aliases(aliases)
}

fn dedupe_aliases(aliases: Vec<String>) -> Vec<String> {
    let mut deduped = Vec::<String>::new();
    let mut seen = BTreeSet::<String>::new();

    for alias in aliases {
        let trimmed = alias.trim();
        if trimmed.is_empty() {
            continue;
        }

        let owned = trimmed.to_string();
        if seen.insert(owned.clone()) {
            deduped.push(owned);
        }
    }

    deduped
}

fn overview_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join("overview.msgpack")
}

fn search_path(cache_dir: &Path) -> PathBuf {
    cache_dir.join("search.msgpack")
}

fn chunks_dir(cache_dir: &Path) -> PathBuf {
    cache_dir.join("chunks")
}

fn chunk_path(cache_dir: &Path, chunk_id: &str) -> PathBuf {
    chunks_dir(cache_dir).join(format!("{chunk_id}.msgpack"))
}

fn write_msgpack_file<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    let payload = rmp_serde::to_vec_named(value).map_err(|err| err.to_string())?;
    fs::write(path, payload).map_err(|err| err.to_string())
}

fn read_msgpack_file<T: DeserializeOwned>(path: &Path) -> Result<T, String> {
    let payload = fs::read(path).map_err(|err| err.to_string())?;
    rmp_serde::from_slice(&payload).map_err(|err| err.to_string())
}

impl From<ChunkCache> for SynthesisNetlistGraphChunkV1 {
    fn from(value: ChunkCache) -> Self {
        Self {
            version: value.version,
            top_module: value.top_module,
            cache_dir: value.cache_dir,
            graph_format: value.graph_format,
            chunk_id: value.chunk_id,
            node_count: value.node_count,
            edge_count: value.edge_count,
            nodes: value.nodes,
            edges: value.edges,
            linked_chunks: value.linked_chunks,
        }
    }
}
