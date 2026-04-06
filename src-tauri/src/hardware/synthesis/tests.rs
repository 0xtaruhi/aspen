use super::*;
use serde_json::json;
use std::{fs, path::PathBuf, time::Instant};

use crate::hardware::types::{
    SynthesisNetlistGraphChunkRequestV1, SynthesisNetlistGraphPrepareRequestV1,
    SynthesisNetlistGraphSearchRequestV1, SynthesisRequestV1, SynthesisSourceFileV1,
};

#[test]
fn sanitize_source_path_discards_parent_components() {
    let path = artifacts::sanitize_source_path("../rtl/top.v", 0);
    assert_eq!(path, PathBuf::from("rtl").join("top.v"));
}

#[test]
fn sanitize_source_path_generates_fallback_filename() {
    let path = artifacts::sanitize_source_path("", 3);
    assert_eq!(path, PathBuf::from("source_3.v"));
}

#[test]
fn create_workdir_generates_unique_paths_for_same_timestamp() {
    let timestamp_ms = 12345;
    let request = SynthesisRequestV1 {
        op_id: "op".to_string(),
        project_name: None,
        project_dir: None,
        top_module: "top".to_string(),
        files: Vec::new(),
    };
    let (first, _) = resolve_workdir(&request, timestamp_ms).unwrap();
    let (second, _) = resolve_workdir(&request, timestamp_ms).unwrap();

    assert_ne!(first, second);
    assert!(first.is_dir());
    assert!(second.is_dir());

    let _ = fs::remove_dir_all(&first);
    let _ = fs::remove_dir_all(&second);
}

#[test]
fn yosys_smoke_test_runs_when_bundled_toolchain_is_available() {
    let yosys_bin = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(BUNDLED_YOSYS_DIR)
        .join("bin")
        .join(toolchain::yosys_executable_name());
    let fde_simlib = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(FDE_RESOURCE_DIR)
        .join(FDE_SIMLIB_FILE);
    let fde_techmap = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(FDE_RESOURCE_DIR)
        .join(FDE_TECHMAP_FILE);
    let fde_cells_map = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(FDE_RESOURCE_DIR)
        .join(FDE_CELLS_MAP_FILE);
    if !yosys_bin.is_file() {
        return;
    }
    if !fde_simlib.is_file() || !fde_techmap.is_file() || !fde_cells_map.is_file() {
        return;
    }

    let request = SynthesisRequestV1 {
        op_id: "test-op".to_string(),
        project_name: Some("test-project".to_string()),
        project_dir: None,
        top_module: "top".to_string(),
        files: vec![SynthesisSourceFileV1 {
            path: "top.v".to_string(),
            content: r#"
module child(
    input wire clk,
    input wire en,
    input wire rst_n,
    output reg q
);
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            q <= 1'b0;
        else if (en)
            q <= ~q;
    end
endmodule

module top(
    input wire clk,
    input wire en,
    input wire rst_n,
    output wire led
);
    child u_child(
        .clk(clk),
        .en(en),
        .rst_n(rst_n),
        .q(led)
    );
endmodule
"#
            .trim()
            .to_string(),
        }],
    };
    let generated_at_ms = now_millis().unwrap();
    let (workdir, _) = resolve_workdir(&request, generated_at_ms).unwrap();

    let report = run_yosys_in_workdir(
        &toolchain::SynthesisToolchainPaths {
            yosys_bin: &yosys_bin,
            fde_simlib: &fde_simlib,
            fde_techmap: &fde_techmap,
            fde_cells_map: &fde_cells_map,
        },
        &workdir,
        &request,
        generated_at_ms,
        Instant::now(),
        |_| {},
    )
    .unwrap();
    let _ = fs::remove_dir_all(&workdir);

    assert!(report.success, "{}", report.log);
    assert!(report
        .artifacts
        .as_ref()
        .and_then(|artifacts| artifacts.edif_path.as_ref())
        .is_some());
    assert!(report.stats.cell_count > 0);
    assert_eq!(report.top_ports.len(), 4);
    assert!(report
        .top_ports
        .iter()
        .any(|port| port.name == "clk" && port.direction == "input" && port.width.is_empty()));
    assert!(report
        .top_ports
        .iter()
        .any(|port| port.name == "led" && port.direction == "output"));
    assert!(
        report
            .stats
            .cell_type_counts
            .iter()
            .any(|entry| entry.cell_type.starts_with("LUT")),
        "{}",
        report.log
    );
    assert!(
        report
            .stats
            .cell_type_counts
            .iter()
            .any(|entry| entry.cell_type.contains("DFF")),
        "{}",
        report.log
    );
}

#[test]
fn parse_synthesized_netlist_filters_internal_yosys_cells_and_extracts_ports() {
    let request = SynthesisRequestV1 {
        op_id: "op".to_string(),
        project_name: None,
        project_dir: None,
        top_module: "top".to_string(),
        files: Vec::new(),
    };
    let generated_at_ms = now_millis().unwrap();
    let (workdir, _) = resolve_workdir(&request, generated_at_ms).unwrap();
    let netlist_path = workdir.join("netlist.json");
    let netlist = json!({
        "modules": {
            "top": {
                "ports": {
                    "clk": {
                        "direction": "input",
                        "bits": [2]
                    },
                    "led": {
                        "direction": "output",
                        "bits": [3, 4, 5, 6],
                        "offset": 0,
                        "upto": 0
                    }
                },
                "netnames": {},
                "memories": {},
                "cells": {
                    "logic0": { "type": "LUT4" },
                    "seq0": { "type": "DFFRHQ" },
                    "meta0": { "type": "$scopeinfo" }
                }
            }
        }
    });

    fs::write(&netlist_path, serde_json::to_vec(&netlist).unwrap()).unwrap();
    let parsed = parse_synthesized_netlist(&netlist_path, "top").unwrap();
    let _ = fs::remove_dir_all(&workdir);

    assert_eq!(parsed.stats.cell_count, 2);
    assert_eq!(parsed.stats.sequential_cell_count, 1);
    assert_eq!(parsed.stats.cell_type_counts.len(), 2);
    assert!(parsed
        .stats
        .cell_type_counts
        .iter()
        .all(|entry| !entry.cell_type.starts_with('$')));
    assert_eq!(parsed.top_ports.len(), 2);
    assert_eq!(parsed.top_ports[0].name, "clk");
    assert_eq!(parsed.top_ports[1].name, "led");
    assert_eq!(parsed.top_ports[1].width, "[3:0]");
}

#[test]
fn prepare_netlist_graph_builds_chunk_cache_and_search_index() {
    let request = SynthesisRequestV1 {
        op_id: "graph".to_string(),
        project_name: Some("graph-demo".to_string()),
        project_dir: None,
        top_module: "top".to_string(),
        files: Vec::new(),
    };
    let generated_at_ms = now_millis().unwrap();
    let (workdir, _) = resolve_workdir(&request, generated_at_ms).unwrap();
    let netlist_path = workdir.join("netlist.json");
    let netlist = json!({
        "modules": {
            "top": {
                "ports": {
                    "clk": {
                        "direction": "input",
                        "bits": [1]
                    },
                    "rst_n": {
                        "direction": "input",
                        "bits": [2]
                    },
                    "led": {
                        "direction": "output",
                        "bits": [6]
                    }
                },
                "netnames": {
                    "clk": { "bits": [1] },
                    "rst_n": { "bits": [2] },
                    "toggle": { "bits": [5] },
                    "led": { "bits": [6] }
                },
                "memories": {},
                "cells": {
                    "ff0": {
                        "type": "DFFRHQ",
                        "parameters": {
                            "INIT": "0"
                        },
                        "port_directions": {
                            "CLK": "input",
                            "D": "input",
                            "Q": "output",
                            "RN": "input"
                        },
                        "connections": {
                            "CLK": [1],
                            "D": [5],
                            "Q": [6],
                            "RN": [2]
                        }
                    },
                    "lut0": {
                        "type": "LUT4",
                        "parameters": {
                            "INIT": "1001011000001111"
                        },
                        "port_directions": {
                            "A": "input",
                            "Y": "output"
                        },
                        "connections": {
                            "A": [6],
                            "Y": [5]
                        }
                    }
                }
            }
        }
    });

    fs::write(&netlist_path, serde_json::to_vec(&netlist).unwrap()).unwrap();

    let overview = prepare_netlist_graph(SynthesisNetlistGraphPrepareRequestV1 {
        top_module: "top".to_string(),
        netlist_json_path: netlist_path.to_string_lossy().to_string(),
        work_dir: Some(workdir.to_string_lossy().to_string()),
        cache_dir: None,
    })
    .unwrap();

    assert!(!overview.chunks.is_empty());
    assert_eq!(overview.top_port_views.len(), 3);
    assert!(overview
        .top_port_views
        .iter()
        .any(|port| port.name == "clk" && !port.chunk_id.is_empty()));
    assert!(PathBuf::from(&overview.cache_dir)
        .join("overview.msgpack")
        .is_file());

    let chunk = read_netlist_graph_chunk(SynthesisNetlistGraphChunkRequestV1 {
        cache_dir: overview.cache_dir.clone(),
        chunk_id: overview.chunks[0].chunk_id.clone(),
    })
    .unwrap();
    assert!(!chunk.nodes.is_empty());
    let lut_node = chunk
        .nodes
        .iter()
        .find(|node| node.label == "lut0")
        .expect("expected lut0 node");
    assert_eq!(lut_node.properties.len(), 1);
    assert_eq!(lut_node.properties[0].key, "INIT");
    assert_eq!(lut_node.properties[0].value, "1001011000001111");
    assert_eq!(
        lut_node.truth_table.as_deref(),
        Some("0b1001_0110_0000_1111 / 0x960F")
    );

    let search = search_prepared_netlist_graph(SynthesisNetlistGraphSearchRequestV1 {
        cache_dir: overview.cache_dir.clone(),
        query: "led".to_string(),
        limit: 8,
    })
    .unwrap();
    let _ = fs::remove_dir_all(&workdir);

    assert!(!search.matches.is_empty());
    assert!(search.matches.iter().any(|entry| entry.label == "led"));
}

#[test]
fn prepare_netlist_graph_search_resolves_hierarchical_and_internal_cell_aliases() {
    let request = SynthesisRequestV1 {
        op_id: "graph-alias".to_string(),
        project_name: Some("graph-alias-demo".to_string()),
        project_dir: None,
        top_module: "top".to_string(),
        files: Vec::new(),
    };
    let generated_at_ms = now_millis().unwrap();
    let (workdir, _) = resolve_workdir(&request, generated_at_ms).unwrap();
    let netlist_path = workdir.join("netlist.json");
    let netlist = json!({
        "modules": {
            "top": {
                "ports": {
                    "clk": { "direction": "input", "bits": [1] },
                    "led": { "direction": "output", "bits": [2] }
                },
                "netnames": {
                    "clk": { "bits": [1] },
                    "led": { "bits": [2] }
                },
                "memories": {},
                "cells": {
                    "top/u_ff0": {
                        "type": "DFFRHQ",
                        "port_directions": {
                            "CLK": "input",
                            "Q": "output"
                        },
                        "connections": {
                            "CLK": [1],
                            "Q": [2]
                        }
                    },
                    "$auto$ff$1": {
                        "type": "DFFRHQ",
                        "port_directions": {
                            "CLK": "input",
                            "Q": "output"
                        },
                        "connections": {
                            "CLK": [1],
                            "Q": [2]
                        }
                    }
                }
            }
        }
    });

    fs::write(&netlist_path, serde_json::to_vec(&netlist).unwrap()).unwrap();

    let overview = prepare_netlist_graph(SynthesisNetlistGraphPrepareRequestV1 {
        top_module: "top".to_string(),
        netlist_json_path: netlist_path.to_string_lossy().to_string(),
        work_dir: Some(workdir.to_string_lossy().to_string()),
        cache_dir: None,
    })
    .unwrap();

    let hierarchical_search = search_prepared_netlist_graph(SynthesisNetlistGraphSearchRequestV1 {
        cache_dir: overview.cache_dir.clone(),
        query: "u_ff0".to_string(),
        limit: 8,
    })
    .unwrap();
    let internal_search = search_prepared_netlist_graph(SynthesisNetlistGraphSearchRequestV1 {
        cache_dir: overview.cache_dir.clone(),
        query: "$auto$ff$1".to_string(),
        limit: 8,
    })
    .unwrap();
    let _ = fs::remove_dir_all(&workdir);

    assert!(hierarchical_search
        .matches
        .iter()
        .any(|entry| entry.node_id.as_deref() == Some("cell:top/u_ff0")));
    assert!(internal_search
        .matches
        .iter()
        .any(|entry| entry.node_id.as_deref() == Some("cell:$auto$ff$1")));
}
