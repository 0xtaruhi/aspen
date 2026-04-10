use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

const BUNDLED_YOSYS_DIR: &str = "vendor/yosys";
const YOSYS_SUPPORT_DIR: &str = "resource/yosys-fde";
const FDE_SIMLIB_FILE: &str = "fdesimlib.v";
const FDE_BRAM_LIB_FILE: &str = "brams.txt";
const FDE_BRAM_MAP_FILE: &str = "brams_map.v";
const FDE_TECHMAP_FILE: &str = "techmap.v";
const FDE_CELLS_MAP_FILE: &str = "cells_map.v";

struct ToolchainPaths {
    yosys_bin: PathBuf,
    fde_simlib: PathBuf,
    fde_bram_lib: PathBuf,
    fde_bram_map: PathBuf,
    fde_techmap: PathBuf,
    fde_cells_map: PathBuf,
}

fn main() {
    if let Err(err) = run() {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let toolchain = bundled_toolchain()?;

    run_case(
        &toolchain,
        "basic",
        "top.v",
        r#"
module top(
    input wire clk,
    input wire en,
    input wire rst_n,
    output reg led
);
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n)
            led <= 1'b0;
        else if (en)
            led <= ~led;
    end
endmodule
"#,
    )?;

    run_case(
        &toolchain,
        "unicode",
        "rtl/子模块/top.v",
        r#"
module top(
    input wire a,
    input wire b,
    output wire y
);
    assign y = a ^ b;
endmodule
"#,
    )?;

    println!("bundled yosys smoke passed");
    Ok(())
}

fn bundled_toolchain() -> Result<ToolchainPaths, String> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let yosys_root = root.join(BUNDLED_YOSYS_DIR);
    let resource_root = root.join(YOSYS_SUPPORT_DIR);
    let toolchain = ToolchainPaths {
        yosys_bin: yosys_root.join("bin").join(yosys_executable_name()),
        fde_simlib: resource_root.join(FDE_SIMLIB_FILE),
        fde_bram_lib: resource_root.join(FDE_BRAM_LIB_FILE),
        fde_bram_map: resource_root.join(FDE_BRAM_MAP_FILE),
        fde_techmap: resource_root.join(FDE_TECHMAP_FILE),
        fde_cells_map: resource_root.join(FDE_CELLS_MAP_FILE),
    };

    for path in [
        &toolchain.yosys_bin,
        &toolchain.fde_simlib,
        &toolchain.fde_bram_lib,
        &toolchain.fde_bram_map,
        &toolchain.fde_techmap,
        &toolchain.fde_cells_map,
    ] {
        if !path.is_file() {
            return Err(format!(
                "missing bundled synthesis resource: {}",
                path.display()
            ));
        }
    }

    Ok(toolchain)
}

fn run_case(
    toolchain: &ToolchainPaths,
    case_name: &str,
    relative_source_path: &str,
    source: &str,
) -> Result<(), String> {
    let workdir = temp_workdir(case_name)?;
    let result = run_case_in_workdir(toolchain, &workdir, relative_source_path, source);
    let _ = fs::remove_dir_all(&workdir);
    result
}

fn run_case_in_workdir(
    toolchain: &ToolchainPaths,
    workdir: &Path,
    relative_source_path: &str,
    source: &str,
) -> Result<(), String> {
    let source_path = workdir.join(relative_source_path);
    if let Some(parent) = source_path.parent() {
        fs::create_dir_all(parent).map_err(|err| err.to_string())?;
    }
    fs::write(&source_path, source.trim()).map_err(|err| err.to_string())?;

    let edif_path = workdir.join("top_syn.edf");
    let script_path = workdir.join("prep.ys");
    fs::write(
        &script_path,
        build_script(toolchain, workdir, &source_path, &edif_path),
    )
    .map_err(|err| err.to_string())?;

    let output = spawn_yosys(toolchain, &script_path, workdir)
        .and_then(|child| child.wait_with_output())
        .map_err(|err| err.to_string())?;
    let log = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );

    if !output.status.success() {
        return Err(format!(
            "yosys smoke failed in {}:\n{log}",
            workdir.display()
        ));
    }
    if !edif_path.is_file() {
        return Err(format!(
            "yosys smoke did not emit EDIF in {}:\n{log}",
            workdir.display()
        ));
    }

    let edif = fs::read_to_string(&edif_path).map_err(|err| err.to_string())?;
    if !edif.contains("(edif top") && !edif.contains("(edif TOP") {
        return Err(format!(
            "unexpected EDIF output in {}:\n{log}",
            edif_path.display()
        ));
    }

    Ok(())
}

fn build_script(
    toolchain: &ToolchainPaths,
    workdir: &Path,
    source_path: &Path,
    edif_path: &Path,
) -> String {
    format!(
        "read_verilog -lib {}\n\
read_verilog -sv {}\n\
hierarchy -check -top top\n\
proc\n\
flatten -noscopeinfo\n\
memory -nomap\n\
opt_clean\n\
memory_libmap -lib {}\n\
techmap -map {}\n\
opt\n\
memory_map\n\
opt -fast\n\
opt -full\n\
techmap -map {}\n\
simplemap\n\
dfflegalize \\\n\
  -cell $_DFF_N_ 01 \\\n\
  -cell $_DFF_P_ 01 \\\n\
  -cell $_DFFE_PP_ 01 \\\n\
  -cell $_DFFE_PN_ 01 \\\n\
  -cell $_DFF_PN0_ r \\\n\
  -cell $_DFF_PN1_ r \\\n\
  -cell $_DFF_PP0_ r \\\n\
  -cell $_DFF_PP1_ r \\\n\
  -cell $_DFF_NN0_ r \\\n\
  -cell $_DFF_NN1_ r \\\n\
  -cell $_DFF_NP0_ r \\\n\
  -cell $_DFF_NP1_ r\n\
techmap -D NO_LUT -map {}\n\
opt\n\
wreduce\n\
clean\n\
dffinit -ff DFFNHQ Q INIT -ff DFFHQ Q INIT -ff EDFFHQ Q INIT -ff DFFRHQ Q INIT -ff DFFSHQ Q INIT -ff DFFNRHQ Q INIT -ff DFFNSHQ Q INIT\n\
abc -lut 4\n\
opt\n\
wreduce\n\
clean\n\
maccmap -unmap\n\
techmap\n\
simplemap\n\
opt\n\
wreduce\n\
clean\n\
abc -lut 4\n\
opt\n\
wreduce\n\
clean\n\
techmap -map {}\n\
opt\n\
check\n\
write_edif {}\n",
        quote_path(&toolchain.fde_simlib),
        quote_workdir_path(workdir, source_path),
        quote_path(&toolchain.fde_bram_lib),
        quote_path(&toolchain.fde_bram_map),
        quote_path(&toolchain.fde_techmap),
        quote_path(&toolchain.fde_cells_map),
        quote_path(&toolchain.fde_cells_map),
        quote_workdir_path(workdir, edif_path),
    )
}

fn spawn_yosys(
    toolchain: &ToolchainPaths,
    script_path: &Path,
    workdir: &Path,
) -> std::io::Result<std::process::Child> {
    #[cfg(target_os = "windows")]
    if let Some(environment_batch) = toolchain
        .yosys_bin
        .parent()
        .and_then(Path::parent)
        .map(|root| root.join("environment.bat"))
        .filter(|path| path.is_file())
    {
        let script_argument = script_path
            .strip_prefix(workdir)
            .map(PathBuf::from)
            .unwrap_or_else(|_| script_path.to_path_buf());
        let mut command = Command::new("cmd");
        command
            .arg("/d")
            .arg("/c")
            .raw_arg(format!(
                "call {} >nul 2>nul & {} -s {}",
                quote_windows_cmd_path(&environment_batch),
                quote_windows_cmd_path(&toolchain.yosys_bin),
                quote_windows_cmd_path(&script_argument),
            ))
            .current_dir(workdir)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        return command.spawn();
    }

    let mut command = Command::new(&toolchain.yosys_bin);
    command
        .arg("-s")
        .arg(script_path)
        .current_dir(workdir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_runtime_env(&mut command, &toolchain.yosys_bin);
    command.spawn()
}

fn configure_runtime_env(command: &mut Command, yosys_bin: &Path) {
    let Some(bin_dir) = yosys_bin.parent() else {
        return;
    };

    let mut runtime_entries = vec![bin_dir.to_path_buf()];
    if let Some(bundle_root) = bin_dir.parent() {
        let libexec_dir = bundle_root.join("libexec");
        if libexec_dir.is_dir() {
            runtime_entries.push(libexec_dir);
        }
    }

    let existing_entries = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    runtime_entries.extend(existing_entries);

    if let Ok(path) = env::join_paths(runtime_entries) {
        command.env("PATH", path);
    }
}

fn quote_path(path: &Path) -> String {
    format!(
        "\"{}\"",
        path.to_string_lossy()
            .replace('\\', "/")
            .replace('"', "\\\"")
    )
}

fn quote_workdir_path(workdir: &Path, path: &Path) -> String {
    let relative = path.strip_prefix(workdir).unwrap_or(path);
    quote_path(relative)
}

#[cfg(target_os = "windows")]
fn quote_windows_cmd_path(path: &Path) -> String {
    format!("\"{}\"", path.display())
}

fn yosys_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yosys.exe"
    } else {
        "yosys"
    }
}

fn temp_workdir(case_name: &str) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_millis();
    let workdir = env::temp_dir().join(format!(
        "aspen-yosys-smoke-{case_name}-{}-{timestamp}",
        std::process::id()
    ));
    fs::create_dir_all(&workdir).map_err(|err| err.to_string())?;
    Ok(workdir)
}
