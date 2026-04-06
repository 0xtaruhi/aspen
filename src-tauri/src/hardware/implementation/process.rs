use std::{
    fs,
    path::{Path, PathBuf},
    sync::mpsc,
    thread,
    time::Instant,
};

use tauri::{AppHandle, Emitter};

use super::{
    now_millis, ImplementationLogChunkV1, ImplementationStageKindV1, ImplementationStageResultV1,
};
use crate::hardware::process_output::stream_output;

pub(super) struct StagePlan {
    pub stage: ImplementationStageKindV1,
    pub optional: bool,
    pub log_path: PathBuf,
    pub output_path: PathBuf,
    pub executable: String,
    pub args: Vec<String>,
}

pub(super) struct StageExecution {
    pub log: String,
    pub result: ImplementationStageResultV1,
}

pub(super) fn run_stage<F>(
    stage: ImplementationStageKindV1,
    optional: bool,
    output_path: &Path,
    log_path: PathBuf,
    spawn: F,
    on_log_chunk: &mut impl FnMut(ImplementationStageKindV1, String),
) -> Result<StageExecution, String>
where
    F: FnOnce() -> std::io::Result<std::process::Child>,
{
    let started_at = Instant::now();
    let mut child =
        spawn().map_err(|err| format!("Failed to launch {:?} stage: {}", stage, err))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| format!("{:?} stage stdout could not be captured", stage))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| format!("{:?} stage stderr could not be captured", stage))?;

    let (tx, rx) = mpsc::channel::<String>();
    let stdout_tx = tx.clone();
    thread::spawn(move || stream_output(stdout, stdout_tx));
    let stderr_tx = tx.clone();
    thread::spawn(move || stream_output(stderr, stderr_tx));
    drop(tx);

    let mut log = String::new();
    for chunk in rx {
        log.push_str(&chunk);
        on_log_chunk(stage, chunk);
    }

    let status = child
        .wait()
        .map_err(|err| format!("Failed to wait for {:?} stage: {}", stage, err))?;
    fs::write(&log_path, log.as_bytes()).map_err(|err| err.to_string())?;

    let elapsed_ms = started_at.elapsed().as_millis().min(u128::from(u64::MAX)) as u64;
    let success = status.success() && output_path.is_file();

    Ok(StageExecution {
        result: ImplementationStageResultV1 {
            stage,
            success,
            optional,
            elapsed_ms,
            exit_code: status.code(),
            log_path: Some(log_path.to_string_lossy().to_string()),
            output_path: output_path
                .is_file()
                .then(|| output_path.to_string_lossy().to_string()),
            error_message: if success {
                None
            } else if output_path.is_file() {
                Some(format!(
                    "{:?} completed with a non-zero exit code but produced its expected artifact.",
                    stage
                ))
            } else {
                Some(format!("{:?} did not complete successfully.", stage))
            },
        },
        log,
    })
}

pub(super) fn emit_log_chunk(
    app: &AppHandle,
    op_id: &str,
    stage: ImplementationStageKindV1,
    chunk: String,
    fallback_timestamp_ms: u64,
) {
    let generated_at_ms = now_millis().unwrap_or(fallback_timestamp_ms);
    let _ = app.emit(
        "hardware:implementation_log",
        ImplementationLogChunkV1 {
            version: 1,
            op_id: op_id.to_string(),
            stage,
            chunk,
            generated_at_ms,
        },
    );
}
