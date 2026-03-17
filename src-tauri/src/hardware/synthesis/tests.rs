use super::*;
use serde_json::json;
use std::{fs, path::PathBuf, time::Instant};

use crate::hardware::types::{SynthesisRequestV1, SynthesisSourceFileV1};

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
            yosys_env: resolve_yosys_environment(&yosys_bin),
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
