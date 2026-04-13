use std::{collections::BTreeMap, fs, path::Path};

use serde_json::Value;

use crate::hardware::types::{SynthesisCellTypeCountV1, SynthesisStatsV1, SynthesisTopPortV1};

const RAMB4_CAPACITY_BITS: u64 = 4096;

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

    let mut generic_memory_count = 0_u64;
    let mut generic_memory_bits = 0_u64;
    for memory in memories.values() {
        let width = memory.get("width").and_then(Value::as_u64).unwrap_or(0);
        let size = memory.get("size").and_then(Value::as_u64).unwrap_or(0);
        generic_memory_count = generic_memory_count.saturating_add(1);
        generic_memory_bits = generic_memory_bits.saturating_add(width.saturating_mul(size));
    }

    let mut mapped_memory_count = 0_u64;
    let mut mapped_memory_bits = 0_u64;
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
        if let Some(capacity_bits) = ramb4_capacity_bits(&cell_type) {
            mapped_memory_count = mapped_memory_count.saturating_add(1);
            mapped_memory_bits = mapped_memory_bits.saturating_add(capacity_bits);
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

    let (memory_count, memory_bits) = if mapped_memory_count > 0 {
        (mapped_memory_count, mapped_memory_bits)
    } else {
        (generic_memory_count, generic_memory_bits)
    };

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

fn ramb4_capacity_bits(cell_type: &str) -> Option<u64> {
    let suffix = cell_type.strip_prefix("RAMB4_")?;
    let parts = suffix.split("_S").collect::<Vec<_>>();
    if !(1..=2).contains(&parts.len()) {
        return None;
    }

    let mut previous_width = 0_u32;
    for part in parts {
        let width = part.strip_prefix('S').unwrap_or(part).parse::<u32>().ok()?;
        if !matches!(width, 1 | 2 | 4 | 8 | 16) {
            return None;
        }
        if previous_width != 0 && width < previous_width {
            return None;
        }
        previous_width = width;
    }

    Some(RAMB4_CAPACITY_BITS)
}
