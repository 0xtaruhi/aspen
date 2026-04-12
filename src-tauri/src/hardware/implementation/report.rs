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
    pub(super) stage_logs: Vec<(ImplementationStageKindV1, String)>,
}

impl<F> StageLogSink<'_, F>
where
    F: FnMut(ImplementationStageKindV1, String),
{
    pub(super) fn push(&mut self, stage: ImplementationStageKindV1, chunk: String) {
        (self.on_log_chunk)(stage, chunk.clone());
        self.combined_log.push_str(&chunk);
        if let Some((_, stage_log)) = self
            .stage_logs
            .iter_mut()
            .find(|(logged_stage, _)| *logged_stage == stage)
        {
            stage_log.push_str(&chunk);
        } else {
            self.stage_logs.push((stage, chunk));
        }
    }

    pub(super) fn stage_log(&self, stage: ImplementationStageKindV1) -> &str {
        self.stage_logs
            .iter()
            .find(|(logged_stage, _)| *logged_stage == stage)
            .map(|(_, log)| log.as_str())
            .unwrap_or_default()
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
    let output_exists = output_path.is_none_or(Path::is_file);
    let success = output_exists && !matches!(report.status, ReportStatus::Failed);
    let mut summary = render_stage_log(
        report,
        if output_exists {
            report_status_name(report.status)
        } else {
            "failed"
        },
        elapsed_ms,
    );
    if !output_exists {
        let _ = writeln!(summary, "error: expected artifact was not produced");
    }
    let mut log = sink.stage_log(stage).to_string();
    log.push_str(&summary);
    fs::write(log_path, log.as_bytes()).map_err(|err| err.to_string())?;
    sink.push(stage, summary);
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
    let summary = format!(
        ">>> completed {} (failed, {} ms)\nerror: {}\n\n",
        stage_name(stage),
        elapsed_ms,
        error.trim()
    );
    let mut log = sink.stage_log(stage).to_string();
    log.push_str(&summary);
    fs::write(log_path, log.as_bytes()).map_err(|err| err.to_string())?;
    sink.push(stage, summary);
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

pub(super) fn render_stage_log(report: &fde::StageReport, status: &str, elapsed_ms: u64) -> String {
    let mut out = String::new();
    let _ = writeln!(
        out,
        ">>> completed {} ({}, {} ms)",
        report.stage, status, elapsed_ms
    );
    for message in &report.messages {
        let _ = writeln!(out, "info: {}", message);
    }
    for warning in &report.warnings {
        let _ = writeln!(out, "warning: {}", warning);
    }
    for (key, value) in &report.metrics {
        let _ = writeln!(out, "metric: {} = {}", key, format_metric_value(value));
    }
    for (key, value) in &report.artifacts {
        let _ = writeln!(out, "artifact: {} = {}", key, value);
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    fn temp_log_path(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::from_secs(0))
            .as_nanos();
        std::env::temp_dir().join(format!("aspen-{name}-{nonce}.log"))
    }

    #[test]
    fn writes_runtime_stage_output_before_final_summary() {
        let mut emitted = Vec::<(ImplementationStageKindV1, String)>::new();
        let mut combined_log = String::new();
        let mut sink = StageLogSink {
            on_log_chunk: &mut |stage, chunk| emitted.push((stage, chunk)),
            combined_log: &mut combined_log,
            stage_logs: Vec::new(),
        };
        let log_path = temp_log_path("stage-runtime");
        let mut report = fde::StageReport::new("map");
        report.push("mapped 1 cells".to_string());

        start_stage(ImplementationStageKindV1::Map, &mut sink);
        sink.push(
            ImplementationStageKindV1::Map,
            "info: building LUT graph\n".to_string(),
        );
        let result = finish_success_stage(
            ImplementationStageKindV1::Map,
            false,
            Instant::now(),
            &log_path,
            None,
            &report,
            &mut sink,
        )
        .expect("finish success stage");

        let written = fs::read_to_string(&log_path).expect("read stage log");
        assert!(result.success);
        assert!(written.contains(">>> starting map\n"));
        assert!(written.contains("info: building LUT graph\n"));
        assert!(written.contains(">>> completed map (success,"));
        assert!(written.contains("info: mapped 1 cells\n"));
        assert_eq!(
            written.matches("info: building LUT graph\n").count(),
            1,
            "runtime lines should not be duplicated in the stage log"
        );
        assert!(
            emitted
                .iter()
                .any(|(stage, chunk)| *stage == ImplementationStageKindV1::Map
                    && chunk.contains(">>> completed map (success,")),
            "completion summary should still be emitted live"
        );

        let _ = fs::remove_file(log_path);
    }
}
