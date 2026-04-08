use super::*;
use serde_json::json;
use std::{fs, path::PathBuf, time::Instant};

use crate::hardware::types::{SynthesisRequestV1, SynthesisSourceFileV1};

fn bundled_synthesis_toolchain() -> Option<toolchain::SynthesisToolchainPaths<'static>> {
    let yosys_bin = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(BUNDLED_YOSYS_DIR)
        .join("bin")
        .join(toolchain::yosys_executable_name());
    let fde_simlib = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(FDE_RESOURCE_DIR)
        .join(FDE_SIMLIB_FILE);
    let fde_bram_lib = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(FDE_RESOURCE_DIR)
        .join(FDE_BRAM_LIB_FILE);
    let fde_bram_map = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(FDE_RESOURCE_DIR)
        .join(FDE_BRAM_MAP_FILE);
    let fde_techmap = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(FDE_RESOURCE_DIR)
        .join(FDE_TECHMAP_FILE);
    let fde_cells_map = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(FDE_RESOURCE_DIR)
        .join(FDE_CELLS_MAP_FILE);

    if !yosys_bin.is_file()
        || !fde_simlib.is_file()
        || !fde_bram_lib.is_file()
        || !fde_bram_map.is_file()
        || !fde_techmap.is_file()
        || !fde_cells_map.is_file()
    {
        return None;
    }

    let toolchain = toolchain::SynthesisToolchainPaths {
        yosys_bin: Box::leak(Box::new(yosys_bin)).as_path(),
        fde_simlib: Box::leak(Box::new(fde_simlib)).as_path(),
        fde_bram_lib: Box::leak(Box::new(fde_bram_lib)).as_path(),
        fde_bram_map: Box::leak(Box::new(fde_bram_map)).as_path(),
        fde_techmap: Box::leak(Box::new(fde_techmap)).as_path(),
        fde_cells_map: Box::leak(Box::new(fde_cells_map)).as_path(),
    };

    Some(toolchain)
}

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
fn frontend_and_backend_synthesis_artifact_flow_revisions_match() {
    let frontend_constant_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("src")
        .join("lib")
        .join("synthesis-artifact-flow.ts");
    let frontend_source = fs::read_to_string(&frontend_constant_path)
        .expect("frontend synthesis artifact flow constant must exist");

    assert!(
        frontend_source.contains(SYNTHESIS_ARTIFACT_FLOW_REVISION),
        "frontend synthesis artifact flow revision is out of sync with backend: expected {SYNTHESIS_ARTIFACT_FLOW_REVISION} in {}",
        frontend_constant_path.display()
    );
}

#[test]
fn yosys_smoke_test_runs_when_bundled_toolchain_is_available() {
    let Some(toolchain) = bundled_synthesis_toolchain() else {
        return;
    };

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
        &toolchain,
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
fn yosys_smoke_test_lowers_division_and_modulo_into_supported_cells() {
    let Some(toolchain) = bundled_synthesis_toolchain() else {
        return;
    };

    let request = SynthesisRequestV1 {
        op_id: "test-div-mod-op".to_string(),
        project_name: Some("test-div-mod-project".to_string()),
        project_dir: None,
        top_module: "top".to_string(),
        files: vec![SynthesisSourceFileV1 {
            path: "top.v".to_string(),
            content: r#"
module top(
    input wire [3:0] a,
    input wire [3:0] b,
    input wire signed [3:0] sa,
    input wire signed [3:0] sb,
    output wire [3:0] q,
    output wire [3:0] r,
    output wire signed [3:0] sq,
    output wire signed [3:0] sr
);
    wire [3:0] b_safe = (b == 4'd0) ? 4'd1 : b;
    wire signed [3:0] sb_safe = (sb == 4'sd0) ? 4'sd1 : sb;

    assign q = a / b_safe;
    assign r = a % b_safe;
    assign sq = sa / sb_safe;
    assign sr = sa % sb_safe;
endmodule
"#
            .trim()
            .to_string(),
        }],
    };
    let generated_at_ms = now_millis().unwrap();
    let (workdir, _) = resolve_workdir(&request, generated_at_ms).unwrap();

    let report = run_yosys_in_workdir(
        &toolchain,
        &workdir,
        &request,
        generated_at_ms,
        Instant::now(),
        |_| {},
    )
    .unwrap();

    assert!(report.success, "{}", report.log);
    let artifacts = report.artifacts.as_ref().expect("artifacts must exist");
    let netlist_path = PathBuf::from(
        artifacts
            .netlist_json_path
            .as_deref()
            .expect("netlist json must exist"),
    );
    let edif_path = PathBuf::from(artifacts.edif_path.as_deref().expect("edif must exist"));
    let netlist = fs::read_to_string(&netlist_path).unwrap();
    let edif = fs::read_to_string(&edif_path).unwrap();
    for forbidden in ["$div", "$mod", "$mul", "$macc", "$macc_v2"] {
        assert!(
            !netlist.contains(forbidden),
            "netlist still contains {forbidden}: {}",
            netlist_path.display()
        );
        assert!(
            !edif.contains(forbidden),
            "edif still contains {forbidden}: {}",
            edif_path.display()
        );
    }
    assert!(
        report
            .stats
            .cell_type_counts
            .iter()
            .all(|entry| !entry.cell_type.starts_with('$')),
        "{}",
        report.log
    );

    let _ = fs::remove_dir_all(&workdir);
}

#[test]
fn yosys_smoke_test_preserves_initialized_ff_properties() {
    let Some(toolchain) = bundled_synthesis_toolchain() else {
        return;
    };

    let request = SynthesisRequestV1 {
        op_id: "test-ff-init-op".to_string(),
        project_name: Some("test-ff-init-project".to_string()),
        project_dir: None,
        top_module: "top".to_string(),
        files: vec![SynthesisSourceFileV1 {
            path: "top.v".to_string(),
            content: r#"
module top(
    input wire clk,
    output reg q0,
    output reg q1
);
    initial q0 = 1'b0;
    initial q1 = 1'b1;

    always @(posedge clk) begin
        q0 <= ~q0;
        q1 <= ~q1;
    end
endmodule
"#
            .trim()
            .to_string(),
        }],
    };
    let generated_at_ms = now_millis().unwrap();
    let (workdir, _) = resolve_workdir(&request, generated_at_ms).unwrap();

    let report = run_yosys_in_workdir(
        &toolchain,
        &workdir,
        &request,
        generated_at_ms,
        Instant::now(),
        |_| {},
    )
    .unwrap();

    assert!(report.success, "{}", report.log);

    let edif_path = report
        .artifacts
        .as_ref()
        .and_then(|artifacts| artifacts.edif_path.as_ref())
        .map(PathBuf::from)
        .expect("edif path");
    let edif = fs::read_to_string(&edif_path).expect("read synthesized edif");
    let _ = fs::remove_dir_all(&workdir);

    assert!(edif.contains("(property INIT (integer 0))"), "{edif}");
    assert!(edif.contains("(property INIT (integer 1))"), "{edif}");
}

#[test]
fn build_yosys_script_runs_bram_mapping_before_memory_map() {
    let script = process::build_yosys_script(process::YosysScriptInput {
        fde_simlib: PathBuf::from("/tmp/fdesimlib.v").as_path(),
        fde_bram_lib: PathBuf::from("/tmp/brams.txt").as_path(),
        fde_bram_map: PathBuf::from("/tmp/brams_map.v").as_path(),
        fde_techmap: PathBuf::from("/tmp/techmap.v").as_path(),
        fde_cells_map: PathBuf::from("/tmp/cells_map.v").as_path(),
        source_paths: &[PathBuf::from("/tmp/top.v")],
        top_module: "top",
        netlist_path: PathBuf::from("/tmp/out.json").as_path(),
        edif_path: PathBuf::from("/tmp/out.edf").as_path(),
    });

    let memory_nomap = script.find("memory -nomap").unwrap();
    let memory_libmap = script.find("memory_libmap -lib").unwrap();
    let bram_techmap = script.find("techmap -map \"/tmp/brams_map.v\"").unwrap();
    let memory_map = script.find("memory_map").unwrap();

    assert!(memory_nomap < memory_libmap);
    assert!(memory_libmap < bram_techmap);
    assert!(bram_techmap < memory_map);
}

#[test]
fn yosys_smoke_test_infers_bram_and_stages_memory_init_assets() {
    let Some(toolchain) = bundled_synthesis_toolchain() else {
        return;
    };

    let request = SynthesisRequestV1 {
        op_id: "test-bram-op".to_string(),
        project_name: Some("test-bram-project".to_string()),
        project_dir: None,
        top_module: "top".to_string(),
        files: vec![
            SynthesisSourceFileV1 {
                path: "rtl/top.v".to_string(),
                content: r#"
module top(
    input wire clk,
    input wire we,
    input wire [7:0] addr,
    input wire [15:0] din,
    output reg [15:0] dout
);
    reg [15:0] mem [0:255];

    initial begin
        $readmemh("init.mem", mem);
    end

    always @(posedge clk) begin
        if (we)
            mem[addr] <= din;
        dout <= mem[addr];
    end
endmodule
"#
                .trim()
                .to_string(),
            },
            SynthesisSourceFileV1 {
                path: "rtl/init.mem".to_string(),
                content: [
                    "1234", "5678", "9abc", "def0", "0001", "0002", "0003", "0004",
                ]
                .join("\n"),
            },
        ],
    };
    let generated_at_ms = now_millis().unwrap();
    let (workdir, _) = resolve_workdir(&request, generated_at_ms).unwrap();

    let report = run_yosys_in_workdir(
        &toolchain,
        &workdir,
        &request,
        generated_at_ms,
        Instant::now(),
        |_| {},
    )
    .unwrap();

    assert!(report.success, "{}", report.log);
    assert_eq!(report.source_count, 1);
    assert!(
        report
            .stats
            .cell_type_counts
            .iter()
            .any(|entry| entry.cell_type == "RAMB4_S16"),
        "{}",
        report.log
    );

    let _ = fs::remove_dir_all(&workdir);
}

#[test]
fn yosys_smoke_test_preserves_explicit_ramb4_primitives() {
    let Some(toolchain) = bundled_synthesis_toolchain() else {
        return;
    };

    let request = SynthesisRequestV1 {
        op_id: "test-explicit-bram-op".to_string(),
        project_name: Some("test-explicit-bram-project".to_string()),
        project_dir: None,
        top_module: "top".to_string(),
        files: vec![SynthesisSourceFileV1 {
            path: "top.v".to_string(),
            content: r#"
module top(
    input wire clk,
    input wire we,
    input wire [7:0] addr,
    input wire [15:0] din,
    output wire [15:0] dout
);
    RAMB4_S16 u_ram (
        .DO(dout),
        .ADDR(addr),
        .DI(din),
        .EN(1'b1),
        .CLK(clk),
        .WE(we),
        .RST(1'b0)
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
        &toolchain,
        &workdir,
        &request,
        generated_at_ms,
        Instant::now(),
        |_| {},
    )
    .unwrap();

    assert!(report.success, "{}", report.log);
    assert!(
        report
            .stats
            .cell_type_counts
            .iter()
            .any(|entry| entry.cell_type == "RAMB4_S16"),
        "{}",
        report.log
    );

    let _ = fs::remove_dir_all(&workdir);
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
