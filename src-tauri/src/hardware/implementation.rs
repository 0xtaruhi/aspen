mod artifacts;
mod process;
mod report;
mod stages;
#[cfg(test)]
mod tests;
mod toolchain;

use std::{
    fs,
    path::Path,
    sync::Arc,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use fde::{load_arch, load_cil, load_constraints, load_delay_model};
use tauri::AppHandle;

use self::{
    artifacts::{plan_artifacts, resolve_workdir, PlannedArtifacts},
    process::emit_log_chunk,
    report::{
        build_failure_report, finish_failed_stage, finish_success_stage, start_stage, StageLogSink,
    },
    stages::{
        run_bitgen_stage, run_map_stage, run_pack_stage, run_place_stage, run_route_stage,
        run_sta_stage, BitgenStageContext,
    },
    toolchain::{resolve_resource_paths, ImplementationResourcePaths},
};
use super::types::{
    ImplementationReportV1, ImplementationRequestV1, ImplementationStageKindV1,
    ImplementationStageResultV1, SynthesisSourceFileV1,
};

const FDE_RESOURCE_DIR: &str = "resource/fde/hw_lib";
const FDE_DC_CELL_FILE: &str = "dc_cell.xml";
const FDE_PACK_CELL_FILE: &str = "fdp3_cell.xml";
const FDE_PACK_DCP_LIB_FILE: &str = "fdp3_dcplib.xml";
const FDE_PACK_CONFIG_FILE: &str = "fdp3_config.xml";
const FDE_ARCH_FILE: &str = "fdp3p7_arch.xml";
const FDE_DELAY_FILE: &str = "fdp3p7_dly.xml";
const FDE_CIL_FILE: &str = "fdp3p7_cil.xml";

pub fn run_fde_implementation(
    app: &AppHandle,
    request: ImplementationRequestV1,
) -> Result<ImplementationReportV1, String> {
    validate_request(&request)?;
    validate_target_device(&request)?;

    let resource_paths = resolve_resource_paths(app)?;
    let generated_at_ms = now_millis()?;
    let started_at = Instant::now();
    let workdir = resolve_workdir(&request, generated_at_ms)?;

    run_fde_implementation_in_workdir(
        &resource_paths,
        &workdir,
        &request,
        generated_at_ms,
        started_at,
        |stage, chunk| emit_log_chunk(app, &request.op_id, stage, chunk, generated_at_ms),
    )
}

fn run_fde_implementation_in_workdir<F>(
    resource_paths: &ImplementationResourcePaths,
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
    let mut sink = StageLogSink {
        on_log_chunk: &mut on_log_chunk,
        combined_log: &mut combined_log,
        stage_logs: Default::default(),
    };
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

    let constraints = Arc::<[_]>::from(
        load_constraints(&artifacts.constraint_path).map_err(|err| err.to_string())?,
    );
    let arch = Arc::new(load_arch(&resource_paths.arch).map_err(|err| err.to_string())?);
    let delay = Arc::new(
        load_delay_model(Some(&resource_paths.delay))
            .map_err(|err| err.to_string())?
            .ok_or_else(|| {
                format!(
                    "Unable to load delay model from {}",
                    resource_paths.delay.display()
                )
            })?,
    );
    let cil = load_cil(&resource_paths.cil).map_err(|err| err.to_string())?;

    let map_result = match run_required_stage(
        &mut ImplementationRunContext {
            request,
            generated_at_ms,
            started_at,
            artifacts: &artifacts,
            stage_results: &mut stage_results,
            sink: &mut sink,
        },
        RequiredStageSpec {
            stage: ImplementationStageKindV1::Map,
            log_path: &workdir.join("map.log"),
            output_path: Some(&artifacts.map_path),
            timing_report_on_failure: String::new(),
        },
        |stage_sink| {
            let mut logger = |line: String| stage_sink.push(ImplementationStageKindV1::Map, line);
            let mut reporter = fde::LineStageReporter::runtime_only(&mut logger);
            run_map_stage(resource_paths, &artifacts, &mut reporter)
        },
    ) {
        Ok(design) => design,
        Err(report) => return Ok(*report),
    };

    let pack_result = match run_required_stage(
        &mut ImplementationRunContext {
            request,
            generated_at_ms,
            started_at,
            artifacts: &artifacts,
            stage_results: &mut stage_results,
            sink: &mut sink,
        },
        RequiredStageSpec {
            stage: ImplementationStageKindV1::Pack,
            log_path: &workdir.join("pack.log"),
            output_path: Some(&artifacts.pack_path),
            timing_report_on_failure: String::new(),
        },
        |stage_sink| {
            let mut logger = |line: String| stage_sink.push(ImplementationStageKindV1::Pack, line);
            let mut reporter = fde::LineStageReporter::runtime_only(&mut logger);
            run_pack_stage(resource_paths, map_result, &artifacts, &mut reporter)
        },
    ) {
        Ok(design) => design,
        Err(report) => return Ok(*report),
    };

    let place_result = match run_required_stage(
        &mut ImplementationRunContext {
            request,
            generated_at_ms,
            started_at,
            artifacts: &artifacts,
            stage_results: &mut stage_results,
            sink: &mut sink,
        },
        RequiredStageSpec {
            stage: ImplementationStageKindV1::Place,
            log_path: &workdir.join("place.log"),
            output_path: Some(&artifacts.place_path),
            timing_report_on_failure: String::new(),
        },
        |stage_sink| {
            let mut logger = |line: String| stage_sink.push(ImplementationStageKindV1::Place, line);
            let mut reporter = fde::LineStageReporter::runtime_only(&mut logger);
            run_place_stage(
                request.place_mode,
                pack_result,
                &artifacts,
                &arch,
                &delay,
                &constraints,
                &mut reporter,
            )
        },
    ) {
        Ok(design) => design,
        Err(report) => return Ok(*report),
    };

    let (routed_design, device_design, route_image) = match run_required_stage(
        &mut ImplementationRunContext {
            request,
            generated_at_ms,
            started_at,
            artifacts: &artifacts,
            stage_results: &mut stage_results,
            sink: &mut sink,
        },
        RequiredStageSpec {
            stage: ImplementationStageKindV1::Route,
            log_path: &workdir.join("route.log"),
            output_path: Some(&artifacts.route_path),
            timing_report_on_failure: String::new(),
        },
        |stage_sink| {
            let mut logger = |line: String| stage_sink.push(ImplementationStageKindV1::Route, line);
            let mut reporter = fde::LineStageReporter::runtime_only(&mut logger);
            run_route_stage(
                place_result,
                &artifacts,
                resource_paths,
                &arch,
                &constraints,
                &cil,
                &mut reporter,
            )
            .map(|(design, device_design, route_image, report)| {
                ((design, device_design, route_image), report)
            })
        },
    ) {
        Ok(routed) => routed,
        Err(report) => return Ok(*report),
    };

    let (design_for_bitgen, timing_report, timing_success) = {
        let stage = ImplementationStageKindV1::Sta;
        let log_path = workdir.join("sta.log");
        start_stage(stage, &mut sink);
        let stage_started = Instant::now();
        let mut logger = |line: String| sink.push(stage, line);
        let mut reporter = fde::LineStageReporter::runtime_only(&mut logger);
        match run_sta_stage(
            routed_design.clone(),
            &artifacts,
            &arch,
            &delay,
            &mut reporter,
        ) {
            Ok((artifact, report)) => {
                let result = finish_success_stage(
                    stage,
                    true,
                    stage_started,
                    &log_path,
                    Some(&artifacts.sta_report_path),
                    &report,
                    &mut sink,
                )?;
                stage_results.push(result);
                (artifact.design, artifact.report_text, true)
            }
            Err(err) => {
                let result = finish_failed_stage(
                    stage,
                    true,
                    stage_started,
                    &log_path,
                    Some(&artifacts.sta_report_path),
                    &err,
                    &mut sink,
                )?;
                stage_results.push(result);
                (routed_design.clone(), err, false)
            }
        }
    };

    if let Err(report) = run_required_stage(
        &mut ImplementationRunContext {
            request,
            generated_at_ms,
            started_at,
            artifacts: &artifacts,
            stage_results: &mut stage_results,
            sink: &mut sink,
        },
        RequiredStageSpec {
            stage: ImplementationStageKindV1::Bitgen,
            log_path: &workdir.join("bitgen.log"),
            output_path: Some(&artifacts.bitstream_path),
            timing_report_on_failure: timing_report.clone(),
        },
        |stage_sink| {
            let mut logger =
                |line: String| stage_sink.push(ImplementationStageKindV1::Bitgen, line);
            let mut reporter = fde::LineStageReporter::runtime_only(&mut logger);
            run_bitgen_stage(
                design_for_bitgen,
                BitgenStageContext {
                    artifacts: &artifacts,
                    resource_paths,
                    arch_name: arch.as_ref().name.as_str(),
                    cil: &cil,
                    device_design,
                    route_image,
                },
                &mut reporter,
            )
            .map(|report| ((), report))
        },
    ) {
        return Ok(*report);
    }

    Ok(ImplementationReportV1 {
        version: 1,
        op_id: request.op_id.clone(),
        success: true,
        timing_success,
        top_module: request.top_module.clone(),
        source_count: count_verilog_sources(&request.files).min(usize::from(u16::MAX)) as u16,
        elapsed_ms: started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64,
        log: std::mem::take(sink.combined_log),
        stages: stage_results,
        artifacts: artifacts.to_snapshot(),
        timing_report,
        generated_at_ms,
    })
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

pub(super) fn count_verilog_sources(files: &[SynthesisSourceFileV1]) -> usize {
    files
        .iter()
        .filter(|file| {
            Path::new(&file.path)
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    extension.eq_ignore_ascii_case("v") || extension.eq_ignore_ascii_case("sv")
                })
        })
        .count()
}

struct ImplementationRunContext<'a, 'sink, F> {
    request: &'a ImplementationRequestV1,
    generated_at_ms: u64,
    started_at: Instant,
    artifacts: &'a PlannedArtifacts,
    stage_results: &'a mut Vec<ImplementationStageResultV1>,
    sink: &'a mut StageLogSink<'sink, F>,
}

impl<F> ImplementationRunContext<'_, '_, F>
where
    F: FnMut(ImplementationStageKindV1, String),
{
    fn failure_report(
        &mut self,
        timing_report: String,
        extra_log: Option<String>,
    ) -> Box<ImplementationReportV1> {
        let mut log = std::mem::take(self.sink.combined_log);
        if let Some(extra_log) = extra_log {
            log.push_str(&extra_log);
        }

        Box::new(build_failure_report(
            self.request,
            self.generated_at_ms,
            self.started_at
                .elapsed()
                .as_millis()
                .min(u128::from(u64::MAX)) as u64,
            log,
            std::mem::take(self.stage_results),
            self.artifacts,
            timing_report,
        ))
    }
}

struct RequiredStageSpec<'a> {
    stage: ImplementationStageKindV1,
    log_path: &'a Path,
    output_path: Option<&'a Path>,
    timing_report_on_failure: String,
}

fn run_required_stage<'sink, F, T, Run>(
    ctx: &mut ImplementationRunContext<'_, 'sink, F>,
    spec: RequiredStageSpec<'_>,
    run: Run,
) -> Result<T, Box<ImplementationReportV1>>
where
    F: FnMut(ImplementationStageKindV1, String),
    Run: FnOnce(&mut StageLogSink<'sink, F>) -> Result<(T, fde::StageReport), String>,
{
    start_stage(spec.stage, ctx.sink);
    let stage_started = Instant::now();
    match run(ctx.sink) {
        Ok((value, report)) => {
            let result = finish_success_stage(
                spec.stage,
                false,
                stage_started,
                spec.log_path,
                spec.output_path,
                &report,
                ctx.sink,
            )
            .map_err(|err| ctx.failure_report(spec.timing_report_on_failure.clone(), Some(err)))?;
            ctx.stage_results.push(result);
            Ok(value)
        }
        Err(err) => {
            let result = finish_failed_stage(
                spec.stage,
                false,
                stage_started,
                spec.log_path,
                spec.output_path,
                &err,
                ctx.sink,
            )
            .map_err(|io_err| {
                ctx.failure_report(spec.timing_report_on_failure.clone(), Some(io_err))
            })?;
            ctx.stage_results.push(result);
            Err(ctx.failure_report(spec.timing_report_on_failure, None))
        }
    }
}
