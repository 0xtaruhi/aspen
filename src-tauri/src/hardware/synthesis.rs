mod artifacts;
mod netlist;
mod process;
#[cfg(test)]
mod tests;
mod toolchain;

use std::{
    fs,
    path::Path,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use tauri::AppHandle;

use self::{
    artifacts::{plan_synthesis_artifacts, resolve_workdir, write_source_file},
    netlist::parse_synthesized_netlist,
    process::{build_yosys_script, emit_log_chunk, stream_output},
    toolchain::{
        resolve_fde_support_file, resolve_yosys_binary, resolve_yosys_environment,
        spawn_yosys_process, SynthesisToolchainPaths,
    },
};
use super::types::{SynthesisLogChunkV1, SynthesisReportV1, SynthesisRequestV1, SynthesisStatsV1};

const BUNDLED_YOSYS_DIR: &str = "vendor/yosys";
const FDE_RESOURCE_DIR: &str = "resource/yosys-fde";
const FDE_SIMLIB_FILE: &str = "fdesimlib.v";
const FDE_TECHMAP_FILE: &str = "techmap.v";
const FDE_CELLS_MAP_FILE: &str = "cells_map.v";
const FDE_LUT_WIDTH: u8 = 4;
const SYNTHESIS_ARTIFACT_FLOW_REVISION: &str = "fde-yosys-edif-v2";

pub fn run_yosys_synthesis(
    app: &AppHandle,
    request: SynthesisRequestV1,
) -> Result<SynthesisReportV1, String> {
    validate_request(&request)?;

    let yosys_bin = resolve_yosys_binary(app)?;
    let fde_simlib = resolve_fde_support_file(app, FDE_SIMLIB_FILE)?;
    let fde_techmap = resolve_fde_support_file(app, FDE_TECHMAP_FILE)?;
    let fde_cells_map = resolve_fde_support_file(app, FDE_CELLS_MAP_FILE)?;
    let toolchain = SynthesisToolchainPaths {
        yosys_bin: &yosys_bin,
        yosys_env: resolve_yosys_environment(&yosys_bin),
        fde_simlib: &fde_simlib,
        fde_techmap: &fde_techmap,
        fde_cells_map: &fde_cells_map,
    };
    let started_at = Instant::now();
    let generated_at_ms = now_millis()?;
    let (workdir, should_cleanup) = resolve_workdir(&request, generated_at_ms)?;
    let result = run_yosys_in_workdir(
        &toolchain,
        &workdir,
        &request,
        generated_at_ms,
        started_at,
        |chunk| emit_log_chunk(app, &request.op_id, chunk, generated_at_ms),
    );
    if should_cleanup {
        let _ = fs::remove_dir_all(&workdir);
    }
    result
}

fn run_yosys_in_workdir<F>(
    toolchain: &SynthesisToolchainPaths<'_>,
    workdir: &Path,
    request: &SynthesisRequestV1,
    generated_at_ms: u64,
    started_at: Instant,
    mut on_log_chunk: F,
) -> Result<SynthesisReportV1, String>
where
    F: FnMut(String),
{
    let sources_dir = workdir.join("sources");
    fs::create_dir_all(&sources_dir).map_err(|err| err.to_string())?;
    let artifacts = plan_synthesis_artifacts(workdir, request);

    let mut source_paths = Vec::with_capacity(request.files.len());
    for (index, file) in request.files.iter().enumerate() {
        let source_path = write_source_file(&sources_dir, file, index)?;
        source_paths.push(source_path);
    }

    let script = build_yosys_script(
        toolchain.fde_simlib,
        toolchain.fde_techmap,
        toolchain.fde_cells_map,
        &source_paths,
        &request.top_module,
        &artifacts.netlist_path,
        &artifacts.edif_path,
    );
    fs::write(&artifacts.script_path, script).map_err(|err| err.to_string())?;

    let mut child =
        spawn_yosys_process(toolchain, &artifacts.script_path, workdir).map_err(|err| {
            format!(
                "Failed to launch Yosys at '{}': {}",
                toolchain.yosys_bin.display(),
                err
            )
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture Yosys stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture Yosys stderr".to_string())?;

    let (tx, rx) = std::sync::mpsc::channel::<String>();
    let stdout_tx = tx.clone();
    std::thread::spawn(move || stream_output(stdout, stdout_tx));
    let stderr_tx = tx.clone();
    std::thread::spawn(move || stream_output(stderr, stderr_tx));
    drop(tx);

    let mut log = String::new();
    for chunk in rx {
        log.push_str(&chunk);
        on_log_chunk(chunk);
    }

    let output_status = child.wait().map_err(|err| {
        format!(
            "Failed to wait for Yosys at '{}': {}",
            toolchain.yosys_bin.display(),
            err
        )
    })?;

    let warnings = log.matches("Warning:").count() as u32;
    let logged_errors = log.matches("ERROR:").count() as u32;
    let elapsed_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;

    if !output_status.success() {
        return Ok(SynthesisReportV1 {
            version: 1,
            op_id: request.op_id.clone(),
            success: false,
            top_module: request.top_module.clone(),
            source_count: request.files.len().min(usize::from(u16::MAX)) as u16,
            tool_path: toolchain.yosys_bin.to_string_lossy().to_string(),
            elapsed_ms,
            warnings,
            errors: logged_errors.max(1),
            log,
            stats: SynthesisStatsV1::default(),
            top_ports: Vec::new(),
            artifacts: Some(artifacts.to_snapshot()),
            generated_at_ms,
        });
    }

    let parsed_netlist = parse_synthesized_netlist(&artifacts.netlist_path, &request.top_module)?;
    Ok(SynthesisReportV1 {
        version: 1,
        op_id: request.op_id.clone(),
        success: true,
        top_module: request.top_module.clone(),
        source_count: request.files.len().min(usize::from(u16::MAX)) as u16,
        tool_path: toolchain.yosys_bin.to_string_lossy().to_string(),
        elapsed_ms,
        warnings,
        errors: logged_errors,
        log,
        stats: parsed_netlist.stats,
        top_ports: parsed_netlist.top_ports,
        artifacts: Some(artifacts.to_snapshot()),
        generated_at_ms,
    })
}

fn validate_request(request: &SynthesisRequestV1) -> Result<(), String> {
    if request.op_id.trim().is_empty() {
        return Err("Synthesis operation id is required".to_string());
    }

    if request.top_module.trim().is_empty() {
        return Err("Top module is required for synthesis".to_string());
    }

    if request.files.is_empty() {
        return Err("At least one Verilog/SystemVerilog source file is required".to_string());
    }

    Ok(())
}

fn now_millis() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis()
        .min(u128::from(u64::MAX)) as u64)
}
