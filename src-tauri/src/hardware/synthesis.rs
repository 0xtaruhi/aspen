use std::{
    collections::BTreeMap,
    env, fs,
    io::{BufRead, BufReader},
    path::{Component, Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde_json::Value;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};

use super::types::{
    SynthesisCellTypeCountV1, SynthesisLogChunkV1, SynthesisReportV1, SynthesisRequestV1,
    SynthesisSourceFileV1, SynthesisStatsV1,
};

const BUNDLED_YOSYS_DIR: &str = "vendor/yosys";

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
    let started_at = Instant::now();
    let generated_at_ms = now_millis()?;
    let workdir = create_workdir(generated_at_ms)?;
    let result = run_yosys_in_workdir(
        &yosys_bin,
        &workdir,
        &request,
        generated_at_ms,
        started_at,
        |chunk| emit_log_chunk(app, &request.op_id, chunk, generated_at_ms),
    );
    let _ = fs::remove_dir_all(&workdir);
    result
}

fn run_yosys_in_workdir<F>(
    yosys_bin: &Path,
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

    let mut source_paths = Vec::with_capacity(request.files.len());
    for (index, file) in request.files.iter().enumerate() {
        let source_path = write_source_file(&sources_dir, file, index)?;
        source_paths.push(source_path);
    }

    let script_path = workdir.join("run.ys");
    let netlist_path = workdir.join("netlist.json");
    let script = build_yosys_script(&source_paths, &request.top_module, &netlist_path);
    fs::write(&script_path, script).map_err(|err| err.to_string())?;

    let output = Command::new(yosys_bin)
        .arg("-s")
        .arg(&script_path)
        .current_dir(workdir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| {
            format!(
                "Failed to launch Yosys at '{}': {}",
                yosys_bin.display(),
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
            yosys_bin.display(),
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
            tool_path: yosys_bin.to_string_lossy().to_string(),
            elapsed_ms,
            warnings,
            errors: logged_errors.max(1),
            log,
            stats: SynthesisStatsV1::default(),
            generated_at_ms,
        });
    }

    let stats = parse_netlist_stats(&netlist_path, &request.top_module)?;
    Ok(SynthesisReportV1 {
        version: 1,
        op_id: request.op_id.clone(),
        success: true,
        top_module: request.top_module.clone(),
        source_count: request.files.len().min(usize::from(u16::MAX)) as u16,
        tool_path: yosys_bin.to_string_lossy().to_string(),
        elapsed_ms,
        warnings,
        errors: logged_errors,
        log,
        stats,
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

fn build_yosys_script(source_paths: &[PathBuf], top_module: &str, netlist_path: &Path) -> String {
    let quoted_sources = source_paths
        .iter()
        .map(|path| quote_yosys_path(path))
        .collect::<Vec<_>>()
        .join(" ");

    format!(
        "read_verilog -sv {quoted_sources}\n\
hierarchy -check -top {top_module}\n\
synth -top {top_module}\n\
write_json {}\n",
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

fn create_workdir(timestamp_ms: u64) -> Result<PathBuf, String> {
    let candidate = env::temp_dir().join(format!(
        "aspen-yosys-{}-{}",
        std::process::id(),
        timestamp_ms
    ));
    fs::create_dir_all(&candidate).map_err(|err| err.to_string())?;
    Ok(candidate)
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

fn parse_netlist_stats(netlist_path: &Path, top_module: &str) -> Result<SynthesisStatsV1, String> {
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

    Ok(SynthesisStatsV1 {
        wire_count,
        wire_bits,
        public_wire_count,
        public_wire_bits,
        memory_count,
        memory_bits,
        cell_count: sorted_cell_types.iter().map(|entry| entry.count).sum(),
        sequential_cell_count,
        cell_type_counts: sorted_cell_types,
    })
}

fn is_sequential_cell_type(cell_type: &str) -> bool {
    let lowered = cell_type.to_ascii_lowercase();
    lowered.contains("dff") || lowered.contains("latch")
}

#[cfg(test)]
mod tests {
    use super::*;
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
    fn yosys_smoke_test_runs_when_bundled_toolchain_is_available() {
        let yosys_bin = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(BUNDLED_YOSYS_DIR)
            .join("bin")
            .join(yosys_executable_name());
        if !yosys_bin.is_file() {
            return;
        }

        let generated_at_ms = now_millis().unwrap();
        let workdir = create_workdir(generated_at_ms).unwrap();
        let request = SynthesisRequestV1 {
            op_id: "test-op".to_string(),
            top_module: "top".to_string(),
            files: vec![SynthesisSourceFileV1 {
                path: "top.v".to_string(),
                content: r#"
module child(
    input wire clk,
    output reg q
);
    always @(posedge clk) begin
        q <= ~q;
    end
endmodule

module top(
    input wire clk,
    output wire led
);
    child u_child(
        .clk(clk),
        .q(led)
    );
endmodule
"#
                .trim()
                .to_string(),
            }],
        };

        let report = run_yosys_in_workdir(
            &yosys_bin,
            &workdir,
            &request,
            generated_at_ms,
            Instant::now(),
            |_| {},
        )
        .unwrap();
        let _ = fs::remove_dir_all(&workdir);

        assert!(report.success, "{}", report.log);
        assert!(report.stats.cell_count > 0);
    }
}
