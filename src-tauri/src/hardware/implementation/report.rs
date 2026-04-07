use std::{fmt::Write as _, fs, path::Path, time::Instant};

use fde::ReportStatus;

use super::super::types::{
    ImplementationReportV1, ImplementationRequestV1, ImplementationStageKindV1,
    ImplementationStageResultV1,
};
use super::{artifacts::PlannedArtifacts, count_verilog_sources};

pub(super) struct StageLogSink<'a, F> {
    pub(super) on_log_chunk: &'a mut F,
    pub(super) combined_log: &'a mut String,
}

impl<F> StageLogSink<'_, F>
where
    F: FnMut(ImplementationStageKindV1, String),
{
    pub(super) fn push(&mut self, stage: ImplementationStageKindV1, chunk: String) {
        (self.on_log_chunk)(stage, chunk.clone());
        self.combined_log.push_str(&chunk);
    }
}

pub(super) fn start_stage(
    stage: ImplementationStageKindV1,
    sink: &mut StageLogSink<'_, impl FnMut(ImplementationStageKindV1, String)>,
) {
    sink.push(stage, format!(">>> starting {}\n", stage_name(stage)));
}

pub(super) fn finish_success_stage(
    stage: ImplementationStageKindV1,
    optional: bool,
    started_at: Instant,
    log_path: &Path,
    output_path: Option<&Path>,
    report: &fde::StageReport,
    sink: &mut StageLogSink<'_, impl FnMut(ImplementationStageKindV1, String)>,
) -> Result<ImplementationStageResultV1, String> {
    let elapsed_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let mut log = render_stage_log(report);
    let output_exists = output_path.is_none_or(Path::is_file);
    let success = output_exists && !matches!(report.status, ReportStatus::Failed);
    if !output_exists {
        let _ = writeln!(log, "error: expected artifact was not produced");
    }
    fs::write(log_path, log.as_bytes()).map_err(|err| err.to_string())?;
    sink.push(stage, log.clone());
    Ok(ImplementationStageResultV1 {
        stage,
        success,
        optional,
        elapsed_ms,
        warning_count: u32::try_from(report.warnings.len()).unwrap_or(u32::MAX),
        error_count: if success { 0 } else { 1 },
        exit_code: Some(if success { 0 } else { 1 }),
        log_path: Some(log_path.to_string_lossy().to_string()),
        output_path: output_path
            .filter(|path| path.is_file())
            .map(|path| path.to_string_lossy().to_string()),
        error_message: if success {
            None
        } else {
            Some(format!(
                "{} did not complete successfully.",
                stage_name(stage)
            ))
        },
    })
}

pub(super) fn finish_failed_stage(
    stage: ImplementationStageKindV1,
    optional: bool,
    started_at: Instant,
    log_path: &Path,
    output_path: Option<&Path>,
    error: &str,
    sink: &mut StageLogSink<'_, impl FnMut(ImplementationStageKindV1, String)>,
) -> Result<ImplementationStageResultV1, String> {
    let elapsed_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let log = format!(
        "stage {} failed\nerror: {}\n",
        stage_name(stage),
        error.trim()
    );
    fs::write(log_path, log.as_bytes()).map_err(|err| err.to_string())?;
    sink.push(stage, log.clone());
    Ok(ImplementationStageResultV1 {
        stage,
        success: false,
        optional,
        elapsed_ms,
        warning_count: 0,
        error_count: 1,
        exit_code: Some(1),
        log_path: Some(log_path.to_string_lossy().to_string()),
        output_path: output_path
            .filter(|path| path.is_file())
            .map(|path| path.to_string_lossy().to_string()),
        error_message: Some(error.trim().to_string()),
    })
}

pub(super) fn render_stage_log(report: &fde::StageReport) -> String {
    let mut out = String::new();
    let _ = writeln!(out, "stage: {}", report.stage);
    let _ = writeln!(out, "status: {}", report_status_name(report.status));
    if let Some(elapsed_ms) = report.elapsed_ms {
        let _ = writeln!(out, "elapsed_ms: {}", elapsed_ms);
    }
    if !report.messages.is_empty() {
        let _ = writeln!(out, "messages:");
        for message in &report.messages {
            let _ = writeln!(out, "  - {}", message);
        }
    }
    if !report.warnings.is_empty() {
        let _ = writeln!(out, "warnings:");
        for warning in &report.warnings {
            let _ = writeln!(out, "  - {}", warning);
        }
    }
    if !report.metrics.is_empty() {
        let _ = writeln!(out, "metrics:");
        for (key, value) in &report.metrics {
            let _ = writeln!(out, "  - {} = {}", key, format_metric_value(value));
        }
    }
    if !report.artifacts.is_empty() {
        let _ = writeln!(out, "artifacts:");
        for (key, value) in &report.artifacts {
            let _ = writeln!(out, "  - {} = {}", key, value);
        }
    }
    out.push('\n');
    out
}

fn format_metric_value(value: &serde_json::Value) -> String {
    match value {
        serde_json::Value::String(text) => text.clone(),
        _ => value.to_string(),
    }
}

fn report_status_name(status: ReportStatus) -> &'static str {
    match status {
        ReportStatus::Success => "success",
        ReportStatus::Failed => "failed",
        ReportStatus::Skipped => "skipped",
    }
}

pub(super) fn stage_name(stage: ImplementationStageKindV1) -> &'static str {
    match stage {
        ImplementationStageKindV1::Yosys => "yosys",
        ImplementationStageKindV1::Map => "map",
        ImplementationStageKindV1::Pack => "pack",
        ImplementationStageKindV1::Place => "place",
        ImplementationStageKindV1::Route => "route",
        ImplementationStageKindV1::Sta => "sta",
        ImplementationStageKindV1::Bitgen => "bitgen",
    }
}

pub(super) fn build_failure_report(
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
        source_count: count_verilog_sources(&request.files).min(usize::from(u16::MAX)) as u16,
        elapsed_ms,
        log,
        stages,
        artifacts: artifacts.to_snapshot(),
        timing_report,
        generated_at_ms,
    }
}
