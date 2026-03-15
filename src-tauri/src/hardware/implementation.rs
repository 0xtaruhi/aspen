use std::{
    env, fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};

use super::types::{
    ImplementationArtifactsV1, ImplementationLogChunkV1, ImplementationReportV1,
    ImplementationRequestV1, ImplementationStageKindV1, ImplementationStageResultV1,
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
static WORKDIR_COUNTER: AtomicU64 = AtomicU64::new(0);

struct ImplementationToolchainPaths {
    fde_bin_dir: PathBuf,
    fde_lib_dir: Option<PathBuf>,
    dc_cell: PathBuf,
    pack_cell: PathBuf,
    pack_dcp_lib: PathBuf,
    pack_config: PathBuf,
    sta_iclib: PathBuf,
    arch: PathBuf,
    delay: PathBuf,
    cil: PathBuf,
}

struct PlannedArtifacts {
    work_dir: PathBuf,
    constraint_path: PathBuf,
    edif_path: PathBuf,
    map_path: PathBuf,
    pack_path: PathBuf,
    place_path: PathBuf,
    route_path: PathBuf,
    sta_output_path: PathBuf,
    sta_report_path: PathBuf,
    bitstream_path: PathBuf,
}

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
    toolchain: &ImplementationToolchainPaths,
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
    let reusable_edif_path = PathBuf::from(
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

    fs::copy(&reusable_edif_path, &artifacts.edif_path).map_err(|err| {
        format!(
            "Failed to stage synthesized EDIF '{}' for implementation: {}",
            reusable_edif_path.display(),
            err
        )
    })?;

    for stage_plan in [
        StagePlan {
            stage: ImplementationStageKindV1::Map,
            optional: false,
            log_path: workdir.join("map.log"),
            output_path: artifacts.map_path.clone(),
            executable: fde_executable_name("map"),
            args: vec![
                "-y".to_string(),
                "-i".to_string(),
                file_name_string(&artifacts.edif_path)?,
                "-o".to_string(),
                file_name_string(&artifacts.map_path)?,
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
                file_name_string(&artifacts.map_path)?,
                "-l".to_string(),
                toolchain.pack_cell.to_string_lossy().to_string(),
                "-r".to_string(),
                toolchain.pack_dcp_lib.to_string_lossy().to_string(),
                "-o".to_string(),
                file_name_string(&artifacts.pack_path)?,
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
                file_name_string(&artifacts.pack_path)?,
                "-o".to_string(),
                file_name_string(&artifacts.place_path)?,
                "-c".to_string(),
                file_name_string(&artifacts.constraint_path)?,
                "-t".to_string(),
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
                file_name_string(&artifacts.place_path)?,
                "-o".to_string(),
                file_name_string(&artifacts.route_path)?,
                "-t".to_string(),
                "-c".to_string(),
                file_name_string(&artifacts.constraint_path)?,
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
                file_name_string(&artifacts.route_path)?,
                "-l".to_string(),
                toolchain.sta_iclib.to_string_lossy().to_string(),
                "-o".to_string(),
                file_name_string(&artifacts.sta_output_path)?,
                "-r".to_string(),
                file_name_string(&artifacts.sta_report_path)?,
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
                file_name_string(&artifacts.route_path)?,
                "-b".to_string(),
                file_name_string(&artifacts.bitstream_path)?,
                "-e".to_string(),
            ],
        },
    ] {
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

struct StagePlan {
    stage: ImplementationStageKindV1,
    optional: bool,
    log_path: PathBuf,
    output_path: PathBuf,
    executable: String,
    args: Vec<String>,
}

struct StageExecution {
    log: String,
    result: ImplementationStageResultV1,
}

fn run_stage<F>(
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

fn stream_output<R: std::io::Read>(reader: R, tx: mpsc::Sender<String>) {
    let mut reader = BufReader::new(reader);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        let read = reader.read_until(b'\n', &mut buffer).unwrap_or(0);
        if read == 0 {
            break;
        }
        let chunk = String::from_utf8_lossy(&buffer).into_owned();
        let _ = tx.send(chunk);
    }
}

fn emit_log_chunk(
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

fn resolve_toolchain_paths(app: &AppHandle) -> Result<ImplementationToolchainPaths, String> {
    let fde_bin_dir = resolve_fde_bin_dir(app)?;

    Ok(ImplementationToolchainPaths {
        fde_lib_dir: resolve_optional_fde_lib_dir(app),
        dc_cell: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_DC_CELL_FILE)?,
        pack_cell: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_PACK_CELL_FILE)?,
        pack_dcp_lib: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_PACK_DCP_LIB_FILE)?,
        pack_config: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_PACK_CONFIG_FILE)?,
        sta_iclib: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_STA_ICLIB_FILE)?,
        arch: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_ARCH_FILE)?,
        delay: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_DELAY_FILE)?,
        cil: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_CIL_FILE)?,
        fde_bin_dir,
    })
}

fn resolve_fde_bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let bundled_resource_candidate = app
        .path()
        .resolve(format!("{}/bin", BUNDLED_FDE_DIR), BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_dir());
    if let Some(candidate) = bundled_resource_candidate {
        return Ok(candidate);
    }

    let bundled_dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(BUNDLED_FDE_DIR)
        .join("bin");
    if bundled_dev_candidate.is_dir() {
        return Ok(bundled_dev_candidate);
    }

    Err(
        "Unable to locate Aspen's bundled FDE toolchain. Run `pnpm prepare:fde-bundle` for local development or build with `src-tauri/tauri.yosys.conf.json` so the bundled toolchain is packaged into the app."
            .to_string(),
    )
}

fn resolve_optional_fde_lib_dir(app: &AppHandle) -> Option<PathBuf> {
    let bundled_resource_candidate = app
        .path()
        .resolve(format!("{}/lib", BUNDLED_FDE_DIR), BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_dir());
    if bundled_resource_candidate.is_some() {
        return bundled_resource_candidate;
    }

    let bundled_dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(BUNDLED_FDE_DIR)
        .join("lib");
    bundled_dev_candidate
        .is_dir()
        .then_some(bundled_dev_candidate)
}

fn resolve_resource_file(
    app: &AppHandle,
    root_dir: &str,
    file_name: &str,
) -> Result<PathBuf, String> {
    let bundled_resource_candidate = app
        .path()
        .resolve(
            format!("{}/{}", root_dir, file_name),
            BaseDirectory::Resource,
        )
        .ok()
        .filter(|path| path.is_file());
    if let Some(candidate) = bundled_resource_candidate {
        return Ok(candidate);
    }

    let bundled_dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(root_dir)
        .join(file_name);
    if bundled_dev_candidate.is_file() {
        return Ok(bundled_dev_candidate);
    }

    Err(format!(
        "Unable to locate Aspen resource '{}'.",
        PathBuf::from(root_dir).join(file_name).display()
    ))
}

fn resolve_workdir(
    request: &ImplementationRequestV1,
    generated_at_ms: u64,
) -> Result<PathBuf, String> {
    let base_name = sanitize_file_stem(&format!("{}_{}", request.project_name, request.top_module));
    if let Some(project_dir) = request
        .project_dir
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let workdir = PathBuf::from(project_dir)
            .join(".aspen")
            .join("fde")
            .join(base_name);
        let _ = fs::remove_dir_all(&workdir);
        fs::create_dir_all(&workdir).map_err(|err| err.to_string())?;
        return Ok(workdir);
    }

    let counter = WORKDIR_COUNTER.fetch_add(1, Ordering::Relaxed);
    let workdir = env::temp_dir().join(format!(
        "aspen-fde-{}-{}-{}",
        std::process::id(),
        generated_at_ms,
        counter
    ));
    fs::create_dir_all(&workdir).map_err(|err| err.to_string())?;
    Ok(workdir)
}

fn plan_artifacts(
    workdir: &Path,
    request: &ImplementationRequestV1,
) -> Result<PlannedArtifacts, String> {
    let base_name = sanitize_file_stem(&format!("{}_{}", request.project_name, request.top_module));
    Ok(PlannedArtifacts {
        work_dir: workdir.to_path_buf(),
        constraint_path: workdir.join(format!("{}_cons.xml", base_name)),
        edif_path: workdir.join(format!("{}_syn.edf", base_name)),
        map_path: workdir.join(format!("{}_map.xml", base_name)),
        pack_path: workdir.join(format!("{}_pack.xml", base_name)),
        place_path: workdir.join(format!("{}_place.xml", base_name)),
        route_path: workdir.join(format!("{}_route.xml", base_name)),
        sta_output_path: workdir.join(format!("{}_sta.xml", base_name)),
        sta_report_path: workdir.join(format!("{}_sta.rpt", base_name)),
        bitstream_path: workdir.join(format!("{}_bit.bit", base_name)),
    })
}

impl PlannedArtifacts {
    fn to_snapshot(&self) -> ImplementationArtifactsV1 {
        ImplementationArtifactsV1 {
            work_dir: self.work_dir.to_string_lossy().to_string(),
            constraint_path: self.constraint_path.to_string_lossy().to_string(),
            edif_path: self
                .edif_path
                .is_file()
                .then(|| self.edif_path.to_string_lossy().to_string()),
            map_path: self
                .map_path
                .is_file()
                .then(|| self.map_path.to_string_lossy().to_string()),
            pack_path: self
                .pack_path
                .is_file()
                .then(|| self.pack_path.to_string_lossy().to_string()),
            place_path: self
                .place_path
                .is_file()
                .then(|| self.place_path.to_string_lossy().to_string()),
            route_path: self
                .route_path
                .is_file()
                .then(|| self.route_path.to_string_lossy().to_string()),
            sta_output_path: self
                .sta_output_path
                .is_file()
                .then(|| self.sta_output_path.to_string_lossy().to_string()),
            sta_report_path: self
                .sta_report_path
                .is_file()
                .then(|| self.sta_report_path.to_string_lossy().to_string()),
            bitstream_path: self
                .bitstream_path
                .is_file()
                .then(|| self.bitstream_path.to_string_lossy().to_string()),
        }
    }
}

fn sanitize_file_stem(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    if sanitized.trim_matches('_').is_empty() {
        "design".to_string()
    } else {
        sanitized
    }
}

fn file_name_string(path: &Path) -> Result<String, String> {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_string())
        .ok_or_else(|| format!("Path '{}' is missing a file name", path.display()))
}

fn spawn_fde_process(
    toolchain: &ImplementationToolchainPaths,
    executable_name: &str,
    args: &[String],
    workdir: &Path,
) -> std::io::Result<std::process::Child> {
    let executable_path = toolchain.fde_bin_dir.join(executable_name);
    let mut command = Command::new(executable_path);
    command.args(args);
    command.current_dir(workdir);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    command.envs(build_fde_runtime_env(toolchain));
    command.spawn()
}

fn build_fde_runtime_env(toolchain: &ImplementationToolchainPaths) -> Vec<(String, String)> {
    let mut envs = Vec::new();
    if let Some(lib_dir) = &toolchain.fde_lib_dir {
        if cfg!(target_os = "macos") {
            envs.push((
                "DYLD_LIBRARY_PATH".to_string(),
                lib_dir.to_string_lossy().to_string(),
            ));
        } else if cfg!(target_os = "linux") {
            envs.push((
                "LD_LIBRARY_PATH".to_string(),
                lib_dir.to_string_lossy().to_string(),
            ));
        }
    }

    if cfg!(target_os = "windows") {
        let existing_path = env::var("PATH").unwrap_or_default();
        let separator = if existing_path.is_empty() { "" } else { ";" };
        envs.push((
            "PATH".to_string(),
            format!(
                "{}{}{}",
                toolchain.fde_bin_dir.to_string_lossy(),
                separator,
                existing_path
            ),
        ));
    }

    envs
}

fn fde_executable_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hardware::types::SynthesisSourceFileV1;
    use std::process::Stdio;

    const TEST_BUNDLED_YOSYS_DIR: &str = "vendor/yosys";
    const TEST_YOSYS_SUPPORT_DIR: &str = "resource/yosys-fde";
    const TEST_FDE_SIMLIB_FILE: &str = "fdesimlib.v";
    const TEST_FDE_TECHMAP_FILE: &str = "techmap.v";
    const TEST_FDE_CELLS_MAP_FILE: &str = "cells_map.v";

    fn test_yosys_executable_name() -> &'static str {
        if cfg!(target_os = "windows") {
            "yosys.exe"
        } else {
            "yosys"
        }
    }

    fn quote_test_yosys_path(path: &Path) -> String {
        format!(
            "\"{}\"",
            path.to_string_lossy()
                .replace('\\', "/")
                .replace('"', "\\\"")
        )
    }

    fn prepare_test_synthesized_edif(workdir: &Path) -> Result<PathBuf, String> {
        let yosys_bin = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(TEST_BUNDLED_YOSYS_DIR)
            .join("bin")
            .join(test_yosys_executable_name());
        let fde_simlib = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(TEST_YOSYS_SUPPORT_DIR)
            .join(TEST_FDE_SIMLIB_FILE);
        let fde_techmap = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(TEST_YOSYS_SUPPORT_DIR)
            .join(TEST_FDE_TECHMAP_FILE);
        let fde_cells_map = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(TEST_YOSYS_SUPPORT_DIR)
            .join(TEST_FDE_CELLS_MAP_FILE);

        if !yosys_bin.is_file()
            || !fde_simlib.is_file()
            || !fde_techmap.is_file()
            || !fde_cells_map.is_file()
        {
            return Err("Bundled Yosys synthesis resources are unavailable".to_string());
        }

        let top_path = workdir.join("top.v");
        fs::write(
            &top_path,
            [
                "module top(",
                "  input wire sw,",
                "  output wire led",
                ");",
                "  assign led = sw;",
                "endmodule",
                "",
            ]
            .join("\n"),
        )
        .map_err(|err| err.to_string())?;

        let edif_path = workdir.join("top_syn.edf");
        let script_path = workdir.join("prep.ys");
        fs::write(
            &script_path,
            format!(
                "read_verilog -lib {}\n\
read_verilog -sv {}\n\
hierarchy -check -top top\n\
proc\n\
flatten -noscopeinfo\n\
memory_map\n\
opt -fast\n\
opt -full\n\
techmap -map {}\n\
simplemap\n\
dfflegalize \\\n\
  -cell $_DFF_N_ x \\\n\
  -cell $_DFF_P_ x \\\n\
  -cell $_DFFE_PP_ x \\\n\
  -cell $_DFFE_PN_ x \\\n\
  -cell $_DFF_PN0_ x \\\n\
  -cell $_DFF_PN1_ x \\\n\
  -cell $_DFF_PP0_ x \\\n\
  -cell $_DFF_PP1_ x \\\n\
  -cell $_DFF_NN0_ x \\\n\
  -cell $_DFF_NN1_ x \\\n\
  -cell $_DFF_NP0_ x \\\n\
  -cell $_DFF_NP1_ x\n\
techmap -D NO_LUT -map {}\n\
opt\n\
wreduce\n\
clean\n\
dffinit -ff DFFNHQ Q INIT -ff DFFHQ Q INIT -ff EDFFHQ Q INIT -ff DFFRHQ Q INIT -ff DFFSHQ Q INIT -ff DFFNRHQ Q INIT -ff DFFNSHQ Q INIT\n\
abc -lut 4\n\
opt\n\
wreduce\n\
clean\n\
techmap -map {}\n\
opt\n\
check\n\
write_edif {}\n",
                quote_test_yosys_path(&fde_simlib),
                quote_test_yosys_path(&top_path),
                quote_test_yosys_path(&fde_techmap),
                quote_test_yosys_path(&fde_cells_map),
                quote_test_yosys_path(&fde_cells_map),
                quote_test_yosys_path(&edif_path)
            ),
        )
        .map_err(|err| err.to_string())?;

        let mut command = if cfg!(target_os = "windows") {
            let environment_batch = yosys_bin
                .parent()
                .and_then(Path::parent)
                .map(|root| root.join("environment.bat"))
                .filter(|path| path.is_file())
                .ok_or_else(|| "Bundled Yosys environment.bat is missing".to_string())?;
            let shell_command = format!(
                "call \"{}\" && \"{}\" -s \"{}\"",
                environment_batch.display(),
                yosys_bin.display(),
                script_path.display()
            );
            let mut command = Command::new("cmd");
            command.arg("/d").arg("/s").arg("/c").arg(shell_command);
            command
        } else {
            let mut command = Command::new(&yosys_bin);
            command.arg("-s").arg(&script_path);
            command
        };

        let output = command
            .current_dir(workdir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|err| err.to_string())?;

        if !output.status.success() || !edif_path.is_file() {
            return Err(format!(
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            ));
        }

        Ok(edif_path)
    }

    #[test]
    fn implementation_smoke_test_runs_when_bundled_toolchains_are_available() {
        let fde_bin_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(BUNDLED_FDE_DIR)
            .join("bin");
        if !fde_bin_dir.is_dir() {
            return;
        }

        let toolchain = ImplementationToolchainPaths {
            fde_lib_dir: {
                let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                    .join(BUNDLED_FDE_DIR)
                    .join("lib");
                candidate.is_dir().then_some(candidate)
            },
            dc_cell: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(FDE_RESOURCE_DIR)
                .join(FDE_DC_CELL_FILE),
            pack_cell: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(FDE_RESOURCE_DIR)
                .join(FDE_PACK_CELL_FILE),
            pack_dcp_lib: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(FDE_RESOURCE_DIR)
                .join(FDE_PACK_DCP_LIB_FILE),
            pack_config: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(FDE_RESOURCE_DIR)
                .join(FDE_PACK_CONFIG_FILE),
            sta_iclib: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(FDE_RESOURCE_DIR)
                .join(FDE_STA_ICLIB_FILE),
            arch: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(FDE_RESOURCE_DIR)
                .join(FDE_ARCH_FILE),
            delay: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(FDE_RESOURCE_DIR)
                .join(FDE_DELAY_FILE),
            cil: PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join(FDE_RESOURCE_DIR)
                .join(FDE_CIL_FILE),
            fde_bin_dir,
        };
        if !toolchain.dc_cell.is_file()
            || !toolchain.pack_cell.is_file()
            || !toolchain.pack_dcp_lib.is_file()
            || !toolchain.pack_config.is_file()
            || !toolchain.sta_iclib.is_file()
            || !toolchain.arch.is_file()
            || !toolchain.delay.is_file()
            || !toolchain.cil.is_file()
        {
            return;
        }

        let generated_at_ms = now_millis().unwrap();
        let workdir = resolve_workdir(
            &ImplementationRequestV1 {
                op_id: "impl-smoke".to_string(),
                project_name: "smoke".to_string(),
                project_dir: None,
                top_module: "top".to_string(),
                target_device_id: "FDP3P7".to_string(),
                constraint_xml: [
                    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
                    "<design name=\"top\">",
                    "  <port name=\"sw\" position=\"P151\"/>",
                    "  <port name=\"led\" position=\"P7\"/>",
                    "</design>",
                    "",
                ]
                .join("\n"),
                files: vec![SynthesisSourceFileV1 {
                    path: "top.v".to_string(),
                    content: [
                        "module top(",
                        "  input wire sw,",
                        "  output wire led",
                        ");",
                        "  assign led = sw;",
                        "endmodule",
                        "",
                    ]
                    .join("\n"),
                }],
                synthesized_edif_path: None,
            },
            generated_at_ms,
        )
        .unwrap();
        let synthesized_edif_path = match prepare_test_synthesized_edif(&workdir) {
            Ok(path) => path,
            Err(_) => return,
        };

        let request = ImplementationRequestV1 {
            op_id: "impl-smoke".to_string(),
            project_name: "smoke".to_string(),
            project_dir: None,
            top_module: "top".to_string(),
            target_device_id: "FDP3P7".to_string(),
            constraint_xml: [
                "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
                "<design name=\"top\">",
                "  <port name=\"sw\" position=\"P151\"/>",
                "  <port name=\"led\" position=\"P7\"/>",
                "</design>",
                "",
            ]
            .join("\n"),
            files: vec![SynthesisSourceFileV1 {
                path: "top.v".to_string(),
                content: [
                    "module top(",
                    "  input wire sw,",
                    "  output wire led",
                    ");",
                    "  assign led = sw;",
                    "endmodule",
                    "",
                ]
                .join("\n"),
            }],
            synthesized_edif_path: Some(synthesized_edif_path.to_string_lossy().to_string()),
        };

        let report = run_fde_implementation_in_workdir(
            &toolchain,
            &workdir,
            &request,
            generated_at_ms,
            Instant::now(),
            |_, _| {},
        )
        .unwrap();

        assert!(report.success, "{}", report.log);
        assert!(report.timing_success, "{}", report.log);
        assert!(report
            .artifacts
            .bitstream_path
            .as_deref()
            .map(Path::new)
            .is_some_and(Path::is_file));
        assert!(report
            .artifacts
            .route_path
            .as_deref()
            .map(Path::new)
            .is_some_and(Path::is_file));
        assert!(!report.timing_report.is_empty());

        let _ = fs::remove_dir_all(&workdir);
    }
}
