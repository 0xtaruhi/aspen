use std::{collections::BTreeMap, fs, path::Path};

use serde_json::Value;

use crate::hardware::types::{SynthesisCellTypeCountV1, SynthesisStatsV1, SynthesisTopPortV1};

pub(super) struct ParsedSynthesisNetlist {
    pub stats: SynthesisStatsV1,
    pub top_ports: Vec<SynthesisTopPortV1>,
}

pub(super) fn parse_synthesized_netlist(
    netlist_path: &Path,
    top_module: &str,
) -> Result<ParsedSynthesisNetlist, String> {
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
    let top_ports = parse_top_ports(top)?;

    let netnames = top
        .get("netnames")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let memories = top
        .get("memories")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let cells = top
        .get("cells")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let mut wire_count = 0_u64;
    let mut wire_bits = 0_u64;
    let mut public_wire_count = 0_u64;
    let mut public_wire_bits = 0_u64;
    for (name, net) in netnames {
        let bit_count = net
            .get("bits")
            .and_then(Value::as_array)
            .map(|bits| bits.len() as u64)
            .unwrap_or(0);
        wire_count = wire_count.saturating_add(1);
        wire_bits = wire_bits.saturating_add(bit_count);
        if !name.starts_with('$') {
            public_wire_count = public_wire_count.saturating_add(1);
            public_wire_bits = public_wire_bits.saturating_add(bit_count);
        }
    }

    let mut memory_count = 0_u64;
    let mut memory_bits = 0_u64;
    for memory in memories.values() {
        let width = memory.get("width").and_then(Value::as_u64).unwrap_or(0);
        let size = memory.get("size").and_then(Value::as_u64).unwrap_or(0);
        memory_count = memory_count.saturating_add(1);
        memory_bits = memory_bits.saturating_add(width.saturating_mul(size));
    }

    let mut sequential_cell_count = 0_u64;
    let mut cell_type_counts = BTreeMap::<String, u64>::new();
    for cell in cells.values() {
        let cell_type = cell
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("$unknown")
            .to_string();
        if !is_public_cell_type(&cell_type) {
            continue;
        }
        *cell_type_counts.entry(cell_type.clone()).or_default() += 1;
        if is_sequential_cell_type(&cell_type) {
            sequential_cell_count = sequential_cell_count.saturating_add(1);
        }
    }

    let mut sorted_cell_types = cell_type_counts
        .into_iter()
        .map(|(cell_type, count)| SynthesisCellTypeCountV1 { cell_type, count })
        .collect::<Vec<_>>();
    sorted_cell_types.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.cell_type.cmp(&right.cell_type))
    });

    Ok(ParsedSynthesisNetlist {
        stats: SynthesisStatsV1 {
            wire_count,
            wire_bits,
            public_wire_count,
            public_wire_bits,
            memory_count,
            memory_bits,
            cell_count: sorted_cell_types.iter().map(|entry| entry.count).sum(),
            sequential_cell_count,
            cell_type_counts: sorted_cell_types,
        },
        top_ports,
    })
}

fn parse_top_ports(top: &Value) -> Result<Vec<SynthesisTopPortV1>, String> {
    let Some(ports) = top.get("ports").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };

    ports
        .iter()
        .map(|(name, port)| {
            let direction = port
                .get("direction")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("Port '{}' is missing direction metadata", name))?;
            let width = build_yosys_port_width(port);

            let normalized_direction = match direction {
                "input" => "input",
                "output" => "output",
                "inout" => "inout",
                other => {
                    return Err(format!(
                        "Port '{}' uses unsupported Yosys direction '{}'",
                        name, other
                    ))
                }
            };

            Ok(SynthesisTopPortV1 {
                name: name.clone(),
                direction: normalized_direction.to_string(),
                width,
            })
        })
        .collect()
}

fn build_yosys_port_width(port: &Value) -> String {
    let bit_count = port
        .get("bits")
        .and_then(Value::as_array)
        .map(|bits| bits.len())
        .unwrap_or(0);
    if bit_count <= 1 {
        return String::new();
    }

    let offset = port.get("offset").and_then(Value::as_i64).unwrap_or(0);
    let upto = port.get("upto").and_then(Value::as_u64).unwrap_or(0) == 1;
    let span = bit_count as i64 - 1;
    let left = if upto { offset } else { offset + span };
    let right = if upto { offset + span } else { offset };

    format!("[{}:{}]", left, right)
}

fn is_sequential_cell_type(cell_type: &str) -> bool {
    let lowered = cell_type.to_ascii_lowercase();
    lowered.contains("dff") || lowered.contains("latch")
}

fn is_public_cell_type(cell_type: &str) -> bool {
    !cell_type.starts_with('$')
}
