use std::{
    collections::BTreeMap,
    env, fs,
    io::{BufRead, BufReader},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
    },
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::Value;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};

use super::types::{
    SynthesisArtifactsV1, SynthesisCellTypeCountV1, SynthesisLogChunkV1, SynthesisReportV1,
    SynthesisRequestV1, SynthesisSourceFileV1, SynthesisStatsV1, SynthesisTopPortV1,
};

const BUNDLED_YOSYS_DIR: &str = "vendor/yosys";
const FDE_RESOURCE_DIR: &str = "resource/yosys-fde";
const FDE_SIMLIB_FILE: &str = "fdesimlib.v";
const FDE_TECHMAP_FILE: &str = "techmap.v";
const FDE_CELLS_MAP_FILE: &str = "cells_map.v";
const FDE_LUT_WIDTH: u8 = 4;
const SYNTHESIS_ARTIFACT_FLOW_REVISION: &str = "fde-yosys-edif-v2";
static WORKDIR_COUNTER: AtomicU64 = AtomicU64::new(0);

struct ParsedSynthesisNetlist {
    stats: SynthesisStatsV1,
    top_ports: Vec<SynthesisTopPortV1>,
}

struct PlannedSynthesisArtifacts {
    work_dir: PathBuf,
    script_path: PathBuf,
    netlist_path: PathBuf,
    edif_path: PathBuf,
}

struct SynthesisToolchainPaths<'a> {
    yosys_bin: &'a Path,
    yosys_env: Option<PathBuf>,
    fde_simlib: &'a Path,
    fde_techmap: &'a Path,
    fde_cells_map: &'a Path,
}

pub fn run_yosys_synthesis(
    app: &AppHandle,
    request: SynthesisRequestV1,
) -> Result<SynthesisReportV1, String> {
    if request.op_id.trim().is_empty() {
        return Err("Synthesis operation id is required".to_string());
    }

    if request.top_module.trim().is_empty() {
        return Err("Top module is required for synthesis".to_string());
    }

    if request.files.is_empty() {
        return Err("At least one Verilog/SystemVerilog source file is required".to_string());
    }

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

    let output =
        spawn_yosys_process(toolchain, &artifacts.script_path, workdir).map_err(|err| {
            format!(
                "Failed to launch Yosys at '{}': {}",
                toolchain.yosys_bin.display(),
                err
            )
        })?;

    let mut child = output;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture Yosys stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Failed to capture Yosys stderr".to_string())?;

    let (tx, rx) = mpsc::channel::<String>();
    let stdout_tx = tx.clone();
    thread::spawn(move || stream_output(stdout, stdout_tx));
    let stderr_tx = tx.clone();
    thread::spawn(move || stream_output(stderr, stderr_tx));
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

fn emit_log_chunk(app: &AppHandle, op_id: &str, chunk: String, fallback_timestamp_ms: u64) {
    let generated_at_ms = now_millis().unwrap_or(fallback_timestamp_ms);
    let _ = app.emit(
        "hardware:synthesis_log",
        SynthesisLogChunkV1 {
            version: 1,
            op_id: op_id.to_string(),
            chunk,
            generated_at_ms,
        },
    );
}

fn resolve_yosys_binary(app: &AppHandle) -> Result<PathBuf, String> {
    let executable_name = yosys_executable_name();
    let bundled_resource_candidate = app
        .path()
        .resolve(
            format!("{}/bin/{}", BUNDLED_YOSYS_DIR, executable_name),
            BaseDirectory::Resource,
        )
        .ok()
        .filter(|path| path.is_file());
    if let Some(candidate) = bundled_resource_candidate {
        return Ok(candidate);
    }

    let bundled_dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(BUNDLED_YOSYS_DIR)
        .join("bin")
        .join(executable_name);
    if bundled_dev_candidate.is_file() {
        return Ok(bundled_dev_candidate);
    }

    Err(
        "Unable to locate Aspen's bundled Yosys. Run `pnpm prepare:yosys-bundle` for local development or build with `src-tauri/tauri.yosys.conf.json` so the bundled toolchain is packaged into the app."
            .to_string(),
    )
}

fn resolve_yosys_environment(yosys_bin: &Path) -> Option<PathBuf> {
    if !cfg!(target_os = "windows") {
        return None;
    }

    yosys_bin
        .parent()
        .and_then(Path::parent)
        .map(|root| root.join("environment.bat"))
        .filter(|path| path.is_file())
}

fn spawn_yosys_process(
    toolchain: &SynthesisToolchainPaths<'_>,
    script_path: &Path,
    workdir: &Path,
) -> std::io::Result<std::process::Child> {
    if cfg!(target_os = "windows") {
        if let Some(environment_batch) = &toolchain.yosys_env {
            let command = format!(
                "call \"{}\" && \"{}\" -s \"{}\"",
                environment_batch.display(),
                toolchain.yosys_bin.display(),
                script_path.display()
            );

            return Command::new("cmd")
                .arg("/d")
                .arg("/s")
                .arg("/c")
                .arg(command)
                .current_dir(workdir)
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn();
        }
    }

    Command::new(toolchain.yosys_bin)
        .arg("-s")
        .arg(script_path)
        .current_dir(workdir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
}

fn resolve_fde_support_file(app: &AppHandle, file_name: &str) -> Result<PathBuf, String> {
    let bundled_resource_candidate = app
        .path()
        .resolve(
            format!("{}/{}", FDE_RESOURCE_DIR, file_name),
            BaseDirectory::Resource,
        )
        .ok()
        .filter(|path| path.is_file());
    if let Some(candidate) = bundled_resource_candidate {
        return Ok(candidate);
    }

    let bundled_dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(FDE_RESOURCE_DIR)
        .join(file_name);
    if bundled_dev_candidate.is_file() {
        return Ok(bundled_dev_candidate);
    }

    Err(format!(
        "Unable to locate Aspen's bundled FDE synthesis support file '{}'. Build with `src-tauri/tauri.yosys.conf.json` or keep `{}/{}` in the source tree for local development.",
        file_name, FDE_RESOURCE_DIR, file_name
    ))
}

fn build_yosys_script(
    fde_simlib: &Path,
    fde_techmap: &Path,
    fde_cells_map: &Path,
    source_paths: &[PathBuf],
    top_module: &str,
    netlist_path: &Path,
    edif_path: &Path,
) -> String {
    let quoted_sources = source_paths
        .iter()
        .map(|path| quote_yosys_path(path))
        .collect::<Vec<_>>()
        .join(" ");

    format!(
        "read_verilog -lib {}\n\
read_verilog -sv {quoted_sources}\n\
hierarchy -check -top {top_module}\n\
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
abc -lut {}\n\
opt\n\
wreduce\n\
clean\n\
techmap -map {}\n\
opt\n\
check\n\
stat\n\
write_edif {}\n\
write_json {}\n",
        quote_yosys_path(fde_simlib),
        quote_yosys_path(fde_techmap),
        quote_yosys_path(fde_cells_map),
        FDE_LUT_WIDTH,
        quote_yosys_path(fde_cells_map),
        quote_yosys_path(edif_path),
        quote_yosys_path(netlist_path)
    )
}

fn write_source_file(
    sources_dir: &Path,
    file: &SynthesisSourceFileV1,
    index: usize,
) -> Result<PathBuf, String> {
    let sanitized_relative_path = sanitize_source_path(&file.path, index);
    let target_path = sources_dir.join(sanitized_relative_path);
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(&target_path, file.content.as_bytes()).map_err(|err| err.to_string())?;
    Ok(target_path)
}

fn sanitize_source_path(path: &str, index: usize) -> PathBuf {
    let mut sanitized = PathBuf::new();
    for component in Path::new(path).components() {
        if let Component::Normal(part) = component {
            sanitized.push(part);
        }
    }

    if sanitized
        .file_name()
        .and_then(|file_name| Path::new(file_name).extension())
        .is_none()
    {
        sanitized.push(format!("source_{}.v", index));
    }

    if sanitized.as_os_str().is_empty() {
        sanitized.push(format!("source_{}.v", index));
    }

    sanitized
}

fn sanitize_file_stem(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    for character in value.chars() {
        if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
            sanitized.push(character);
        } else if !sanitized.ends_with('_') {
            sanitized.push('_');
        }
    }

    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "artifact".to_string()
    } else {
        trimmed.to_string()
    }
}

fn plan_synthesis_artifacts(
    workdir: &Path,
    request: &SynthesisRequestV1,
) -> PlannedSynthesisArtifacts {
    let project_name = request
        .project_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("project");
    let base_name = sanitize_file_stem(&format!("{}_{}", project_name, request.top_module));

    PlannedSynthesisArtifacts {
        work_dir: workdir.to_path_buf(),
        script_path: workdir.join(format!("{}_synth.ys", base_name)),
        netlist_path: workdir.join(format!("{}_netlist.json", base_name)),
        edif_path: workdir.join(format!("{}_syn.edf", base_name)),
    }
}

impl PlannedSynthesisArtifacts {
    fn to_snapshot(&self) -> SynthesisArtifactsV1 {
        SynthesisArtifactsV1 {
            work_dir: self.work_dir.to_string_lossy().to_string(),
            script_path: self
                .script_path
                .is_file()
                .then(|| self.script_path.to_string_lossy().to_string()),
            netlist_json_path: self
                .netlist_path
                .is_file()
                .then(|| self.netlist_path.to_string_lossy().to_string()),
            edif_path: self
                .edif_path
                .is_file()
                .then(|| self.edif_path.to_string_lossy().to_string()),
            flow_revision: Some(SYNTHESIS_ARTIFACT_FLOW_REVISION.to_string()),
        }
    }
}

fn resolve_workdir(
    request: &SynthesisRequestV1,
    timestamp_ms: u64,
) -> Result<(PathBuf, bool), String> {
    if let Some(project_dir) = request
        .project_dir
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let project_name = request
            .project_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or("project");
        let base_name = sanitize_file_stem(&format!("{}_{}", project_name, request.top_module));
        let workdir = PathBuf::from(project_dir)
            .join(".aspen")
            .join("synthesis")
            .join(base_name);
        let _ = fs::remove_dir_all(&workdir);
        fs::create_dir_all(&workdir).map_err(|err| err.to_string())?;
        return Ok((workdir, false));
    }

    let counter = WORKDIR_COUNTER.fetch_add(1, Ordering::Relaxed);
    let candidate = env::temp_dir().join(format!(
        "aspen-yosys-{}-{}-{}",
        std::process::id(),
        timestamp_ms,
        counter
    ));
    fs::create_dir_all(&candidate).map_err(|err| err.to_string())?;
    Ok((candidate, true))
}

fn quote_yosys_path(path: &Path) -> String {
    format!(
        "\"{}\"",
        path.to_string_lossy()
            .replace('\\', "/")
            .replace('"', "\\\"")
    )
}

fn yosys_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yosys.exe"
    } else {
        "yosys"
    }
}

fn now_millis() -> Result<u64, String> {
    Ok(SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis()
        .min(u128::from(u64::MAX)) as u64)
}

fn parse_synthesized_netlist(
    netlist_path: &Path,
    top_module: &str,
) -> Result<ParsedSynthesisNetlist, String> {
    let netlist = fs::read_to_string(netlist_path).map_err(|err| err.to_string())?;
    let json: Value = serde_json::from_str(&netlist).map_err(|err| err.to_string())?;
    let top = json
        .get("modules")
        .and_then(Value::as_object)
        .and_then(|modules| modules.get(top_module))
        .ok_or_else(|| {
            format!(
                "Top module '{}' not found in synthesized netlist",
                top_module
            )
        })?;
    let top_ports = parse_top_ports(top)?;

    let netnames = top
        .get("netnames")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let memories = top
        .get("memories")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();
    let cells = top
        .get("cells")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let mut wire_count = 0_u64;
    let mut wire_bits = 0_u64;
    let mut public_wire_count = 0_u64;
    let mut public_wire_bits = 0_u64;
    for (name, net) in netnames {
        let bit_count = net
            .get("bits")
            .and_then(Value::as_array)
            .map(|bits| bits.len() as u64)
            .unwrap_or(0);
        wire_count = wire_count.saturating_add(1);
        wire_bits = wire_bits.saturating_add(bit_count);
        if !name.starts_with('$') {
            public_wire_count = public_wire_count.saturating_add(1);
            public_wire_bits = public_wire_bits.saturating_add(bit_count);
        }
    }

    let mut memory_count = 0_u64;
    let mut memory_bits = 0_u64;
    for memory in memories.values() {
        let width = memory.get("width").and_then(Value::as_u64).unwrap_or(0);
        let size = memory.get("size").and_then(Value::as_u64).unwrap_or(0);
        memory_count = memory_count.saturating_add(1);
        memory_bits = memory_bits.saturating_add(width.saturating_mul(size));
    }

    let mut sequential_cell_count = 0_u64;
    let mut cell_type_counts = BTreeMap::<String, u64>::new();
    for cell in cells.values() {
        let cell_type = cell
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("$unknown")
            .to_string();
        if !is_public_cell_type(&cell_type) {
            continue;
        }
        *cell_type_counts.entry(cell_type.clone()).or_default() += 1;
        if is_sequential_cell_type(&cell_type) {
            sequential_cell_count = sequential_cell_count.saturating_add(1);
        }
    }

    let mut sorted_cell_types = cell_type_counts
        .into_iter()
        .map(|(cell_type, count)| SynthesisCellTypeCountV1 { cell_type, count })
        .collect::<Vec<_>>();
    sorted_cell_types.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.cell_type.cmp(&right.cell_type))
    });

    Ok(ParsedSynthesisNetlist {
        stats: SynthesisStatsV1 {
            wire_count,
            wire_bits,
            public_wire_count,
            public_wire_bits,
            memory_count,
            memory_bits,
            cell_count: sorted_cell_types.iter().map(|entry| entry.count).sum(),
            sequential_cell_count,
            cell_type_counts: sorted_cell_types,
        },
        top_ports,
    })
}

fn parse_top_ports(top: &Value) -> Result<Vec<SynthesisTopPortV1>, String> {
    let Some(ports) = top.get("ports").and_then(Value::as_object) else {
        return Ok(Vec::new());
    };

    ports
        .iter()
        .map(|(name, port)| {
            let direction = port
                .get("direction")
                .and_then(Value::as_str)
                .ok_or_else(|| format!("Port '{}' is missing direction metadata", name))?;
            let width = build_yosys_port_width(port);

            let normalized_direction = match direction {
                "input" => "input",
                "output" => "output",
                "inout" => "inout",
                other => {
                    return Err(format!(
                        "Port '{}' uses unsupported Yosys direction '{}'",
                        name, other
                    ))
                }
            };

            Ok(SynthesisTopPortV1 {
                name: name.clone(),
                direction: normalized_direction.to_string(),
                width,
            })
        })
        .collect()
}

fn build_yosys_port_width(port: &Value) -> String {
    let bit_count = port
        .get("bits")
        .and_then(Value::as_array)
        .map(|bits| bits.len())
        .unwrap_or(0);
    if bit_count <= 1 {
        return String::new();
    }

    let offset = port.get("offset").and_then(Value::as_i64).unwrap_or(0);
    let upto = port.get("upto").and_then(Value::as_u64).unwrap_or(0) == 1;
    let span = bit_count as i64 - 1;
    let left = if upto { offset } else { offset + span };
    let right = if upto { offset + span } else { offset };

    format!("[{}:{}]", left, right)
}

fn is_sequential_cell_type(cell_type: &str) -> bool {
    let lowered = cell_type.to_ascii_lowercase();
    lowered.contains("dff") || lowered.contains("latch")
}

fn is_public_cell_type(cell_type: &str) -> bool {
    !cell_type.starts_with('$')
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Instant;

    #[test]
    fn sanitize_source_path_discards_parent_components() {
        let path = sanitize_source_path("../rtl/top.v", 0);
        assert_eq!(path, PathBuf::from("rtl").join("top.v"));
    }

    #[test]
    fn sanitize_source_path_generates_fallback_filename() {
        let path = sanitize_source_path("", 3);
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
            .join(yosys_executable_name());
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
            &SynthesisToolchainPaths {
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
}
