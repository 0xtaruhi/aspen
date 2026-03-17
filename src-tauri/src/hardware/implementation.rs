mod artifacts;
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
    artifacts::{path_argument, plan_artifacts, resolve_workdir, PlannedArtifacts},
    process::{emit_log_chunk, run_stage, StagePlan},
    toolchain::{fde_executable_name, resolve_toolchain_paths, spawn_fde_process},
};
use super::types::{
    ImplementationLogChunkV1, ImplementationPlaceModeV1, ImplementationReportV1,
    ImplementationRequestV1, ImplementationRouteModeV1, ImplementationStageKindV1,
    ImplementationStageResultV1,
};

const BUNDLED_FDE_DIR: &str = "vendor/fde";
const FDE_RESOURCE_DIR: &str = "resource/fde/hw_lib";
const FDE_DC_CELL_FILE: &str = "dc_cell.xml";
const FDE_PACK_CELL_FILE: &str = "fdp3_cell.xml";
const FDE_PACK_DCP_LIB_FILE: &str = "fdp3_dcplib.xml";
const FDE_PACK_CONFIG_FILE: &str = "fdp3_config.xml";
const FDE_STA_ICLIB_FILE: &str = "fdp3_con.xml";
const FDE_ARCH_FILE: &str = "fdp3p7_arch.xml";
const FDE_DELAY_FILE: &str = "fdp3p7_dly.xml";
const FDE_CIL_FILE: &str = "fdp3p7_cil.xml";
const FDE_FAMILY_NAME: &str = "fdp3";

pub fn run_fde_implementation(
    app: &AppHandle,
    request: ImplementationRequestV1,
) -> Result<ImplementationReportV1, String> {
    validate_request(&request)?;
    validate_target_device(&request)?;

    let toolchain = resolve_toolchain_paths(app)?;
    let generated_at_ms = now_millis()?;
    let started_at = Instant::now();
    let workdir = resolve_workdir(&request, generated_at_ms)?;

    run_fde_implementation_in_workdir(
        &toolchain,
        &workdir,
        &request,
        generated_at_ms,
        started_at,
        |stage, chunk| emit_log_chunk(app, &request.op_id, stage, chunk, generated_at_ms),
    )
}

fn run_fde_implementation_in_workdir<F>(
    toolchain: &toolchain::ImplementationToolchainPaths,
    workdir: &Path,
    request: &ImplementationRequestV1,
    generated_at_ms: u64,
    started_at: Instant,
    mut on_log_chunk: F,
) -> Result<ImplementationReportV1, String>
where
    F: FnMut(ImplementationStageKindV1, String),
{
    fs::create_dir_all(workdir).map_err(|err| err.to_string())?;
    let artifacts = plan_artifacts(workdir, request)?;
    fs::write(
        &artifacts.constraint_path,
        request.constraint_xml.as_bytes(),
    )
    .map_err(|err| err.to_string())?;

    let mut combined_log = String::new();
    let mut stage_results = Vec::new();
    let reusable_edif_path = Path::new(
        request
            .synthesized_edif_path
            .as_deref()
            .ok_or_else(|| {
                "Implementation requires an up-to-date synthesized EDIF artifact. Run Synthesis again before Implementation.".to_string()
            })?,
    );
    if !reusable_edif_path.is_file() {
        return Err(format!(
            "Implementation requires a synthesized EDIF artifact, but '{}' could not be found. Run Synthesis again before Implementation.",
            reusable_edif_path.display()
        ));
    }

    fs::copy(reusable_edif_path, &artifacts.edif_path).map_err(|err| {
        format!(
            "Failed to stage synthesized EDIF '{}' for implementation: {}",
            reusable_edif_path.display(),
            err
        )
    })?;

    for stage_plan in build_stage_plans(toolchain, workdir, request, &artifacts)? {
        let stage_execution = run_stage(
            stage_plan.stage,
            stage_plan.optional,
            &stage_plan.output_path,
            stage_plan.log_path,
            || spawn_fde_process(toolchain, &stage_plan.executable, &stage_plan.args, workdir),
            &mut on_log_chunk,
        )?;
        combined_log.push_str(&stage_execution.log);
        stage_results.push(stage_execution.result);

        let failed = stage_results
            .last()
            .map(|result| !result.success)
            .unwrap_or(false);
        if failed && !stage_plan.optional {
            let timing_report = read_optional_file(&artifacts.sta_report_path);
            return Ok(build_failure_report(
                request,
                generated_at_ms,
                started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
                combined_log,
                stage_results,
                &artifacts,
                timing_report,
            ));
        }
    }

    let elapsed_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let timing_report = read_optional_file(&artifacts.sta_report_path);
    let timing_success = stage_results
        .iter()
        .find(|stage| stage.stage == ImplementationStageKindV1::Sta)
        .map(|stage| stage.success)
        .unwrap_or(false);

    Ok(ImplementationReportV1 {
        version: 1,
        op_id: request.op_id.clone(),
        success: true,
        timing_success,
        top_module: request.top_module.clone(),
        source_count: request.files.len().min(usize::from(u16::MAX)) as u16,
        elapsed_ms,
        log: combined_log,
        stages: stage_results,
        artifacts: artifacts.to_snapshot(),
        timing_report,
        generated_at_ms,
    })
}

fn build_stage_plans(
    toolchain: &toolchain::ImplementationToolchainPaths,
    workdir: &Path,
    request: &ImplementationRequestV1,
    artifacts: &PlannedArtifacts,
) -> Result<Vec<StagePlan>, String> {
    Ok(vec![
        StagePlan {
            stage: ImplementationStageKindV1::Map,
            optional: false,
            log_path: workdir.join("map.log"),
            output_path: artifacts.map_path.clone(),
            executable: fde_executable_name("map"),
            args: vec![
                "-y".to_string(),
                "-i".to_string(),
                path_argument(&artifacts.edif_path, workdir)?,
                "-o".to_string(),
                path_argument(&artifacts.map_path, workdir)?,
                "-c".to_string(),
                toolchain.dc_cell.to_string_lossy().to_string(),
                "-e".to_string(),
            ],
        },
        StagePlan {
            stage: ImplementationStageKindV1::Pack,
            optional: false,
            log_path: workdir.join("pack.log"),
            output_path: artifacts.pack_path.clone(),
            executable: fde_executable_name("pack"),
            args: vec![
                "-c".to_string(),
                FDE_FAMILY_NAME.to_string(),
                "-n".to_string(),
                path_argument(&artifacts.map_path, workdir)?,
                "-l".to_string(),
                toolchain.pack_cell.to_string_lossy().to_string(),
                "-r".to_string(),
                toolchain.pack_dcp_lib.to_string_lossy().to_string(),
                "-o".to_string(),
                path_argument(&artifacts.pack_path, workdir)?,
                "-g".to_string(),
                toolchain.pack_config.to_string_lossy().to_string(),
                "-e".to_string(),
            ],
        },
        StagePlan {
            stage: ImplementationStageKindV1::Place,
            optional: false,
            log_path: workdir.join("place.log"),
            output_path: artifacts.place_path.clone(),
            executable: fde_executable_name("place"),
            args: vec![
                "-a".to_string(),
                toolchain.arch.to_string_lossy().to_string(),
                "-d".to_string(),
                toolchain.delay.to_string_lossy().to_string(),
                "-i".to_string(),
                path_argument(&artifacts.pack_path, workdir)?,
                "-o".to_string(),
                path_argument(&artifacts.place_path, workdir)?,
                "-c".to_string(),
                path_argument(&artifacts.constraint_path, workdir)?,
                place_mode_flag(request.place_mode).to_string(),
                "-e".to_string(),
            ],
        },
        StagePlan {
            stage: ImplementationStageKindV1::Route,
            optional: false,
            log_path: workdir.join("route.log"),
            output_path: artifacts.route_path.clone(),
            executable: fde_executable_name("route"),
            args: vec![
                "-a".to_string(),
                toolchain.arch.to_string_lossy().to_string(),
                "-n".to_string(),
                path_argument(&artifacts.place_path, workdir)?,
                "-o".to_string(),
                path_argument(&artifacts.route_path, workdir)?,
                route_mode_flag(request.route_mode).to_string(),
                "-c".to_string(),
                path_argument(&artifacts.constraint_path, workdir)?,
                "-e".to_string(),
            ],
        },
        StagePlan {
            stage: ImplementationStageKindV1::Sta,
            optional: true,
            log_path: workdir.join("sta.log"),
            output_path: artifacts.sta_report_path.clone(),
            executable: fde_executable_name("sta"),
            args: vec![
                "-a".to_string(),
                toolchain.arch.to_string_lossy().to_string(),
                "-i".to_string(),
                path_argument(&artifacts.route_path, workdir)?,
                "-l".to_string(),
                toolchain.sta_iclib.to_string_lossy().to_string(),
                "-o".to_string(),
                path_argument(&artifacts.sta_output_path, workdir)?,
                "-r".to_string(),
                path_argument(&artifacts.sta_report_path, workdir)?,
                "-e".to_string(),
            ],
        },
        StagePlan {
            stage: ImplementationStageKindV1::Bitgen,
            optional: false,
            log_path: workdir.join("bitgen.log"),
            output_path: artifacts.bitstream_path.clone(),
            executable: fde_executable_name("bitgen"),
            args: vec![
                "-a".to_string(),
                toolchain.arch.to_string_lossy().to_string(),
                "-c".to_string(),
                toolchain.cil.to_string_lossy().to_string(),
                "-n".to_string(),
                path_argument(&artifacts.route_path, workdir)?,
                "-b".to_string(),
                path_argument(&artifacts.bitstream_path, workdir)?,
                "-e".to_string(),
            ],
        },
    ])
}

fn validate_request(request: &ImplementationRequestV1) -> Result<(), String> {
    if request.op_id.trim().is_empty() {
        return Err("Implementation operation id is required".to_string());
    }
    if request.project_name.trim().is_empty() {
        return Err("Project name is required for implementation".to_string());
    }
    if request.top_module.trim().is_empty() {
        return Err("Top module is required for implementation".to_string());
    }
    if request.files.is_empty() {
        return Err("Implementation requires at least one source file".to_string());
    }
    if request.constraint_xml.trim().is_empty() {
        return Err("Implementation requires a constraint XML payload".to_string());
    }
    if request
        .synthesized_edif_path
        .as_deref()
        .map(str::trim)
        .is_none_or(str::is_empty)
    {
        return Err(
            "Implementation requires an up-to-date synthesized EDIF artifact. Run Synthesis again before Implementation."
                .to_string(),
        );
    }
    Ok(())
}

fn place_mode_flag(mode: ImplementationPlaceModeV1) -> &'static str {
    match mode {
        ImplementationPlaceModeV1::TimingDriven => "-t",
        ImplementationPlaceModeV1::BoundingBox => "-b",
    }
}

fn route_mode_flag(mode: ImplementationRouteModeV1) -> &'static str {
    match mode {
        ImplementationRouteModeV1::TimingDriven => "-t",
        ImplementationRouteModeV1::DirectSearch => "-d",
        ImplementationRouteModeV1::BreadthFirst => "-b",
    }
}

fn validate_target_device(request: &ImplementationRequestV1) -> Result<(), String> {
    if request.target_device_id.eq_ignore_ascii_case("FDP3P7") {
        return Ok(());
    }

    Err(format!(
        "Target device '{}' is not yet supported by the FDE implementation flow.",
        request.target_device_id
    ))
}

fn now_millis() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis()
        .min(u128::from(u64::MAX)) as u64)
}

fn build_failure_report(
    request: &ImplementationRequestV1,
    generated_at_ms: u64,
    elapsed_ms: u64,
    log: String,
    stages: Vec<ImplementationStageResultV1>,
    artifacts: &PlannedArtifacts,
    timing_report: String,
) -> ImplementationReportV1 {
    let timing_success = stages
        .iter()
        .find(|stage| stage.stage == ImplementationStageKindV1::Sta)
        .map(|stage| stage.success)
        .unwrap_or(false);

    ImplementationReportV1 {
        version: 1,
        op_id: request.op_id.clone(),
        success: false,
        timing_success,
        top_module: request.top_module.clone(),
        source_count: request.files.len().min(usize::from(u16::MAX)) as u16,
        elapsed_ms,
        log,
        stages,
        artifacts: artifacts.to_snapshot(),
        timing_report,
        generated_at_ms,
    }
}

fn read_optional_file(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}
