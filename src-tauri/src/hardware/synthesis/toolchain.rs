use std::{
    env,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::{path::BaseDirectory, AppHandle, Manager};

use super::{BUNDLED_YOSYS_DIR, FDE_RESOURCE_DIR};

pub(super) struct SynthesisToolchainPaths<'a> {
    pub yosys_bin: &'a Path,
    pub fde_simlib: &'a Path,
    pub fde_bram_lib: &'a Path,
    pub fde_bram_map: &'a Path,
    pub fde_techmap: &'a Path,
    pub fde_cells_map: &'a Path,
}

pub(super) fn resolve_yosys_binary(app: &AppHandle) -> Result<PathBuf, String> {
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

pub(super) fn spawn_yosys_process(
    toolchain: &SynthesisToolchainPaths<'_>,
    script_path: &Path,
    workdir: &Path,
) -> std::io::Result<std::process::Child> {
    #[cfg(target_os = "windows")]
    if let Some(environment_batch) = resolve_yosys_environment(toolchain.yosys_bin) {
        return spawn_windows_yosys_process(
            &environment_batch,
            toolchain.yosys_bin,
            script_path,
            workdir,
        );
    }

    let mut command = Command::new(toolchain.yosys_bin);
    command
        .arg("-s")
        .arg(script_path)
        .current_dir(workdir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_yosys_runtime_env(&mut command, toolchain.yosys_bin);
    command.spawn()
}

fn configure_yosys_runtime_env(command: &mut Command, yosys_bin: &Path) {
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

#[cfg(target_os = "windows")]
fn resolve_yosys_environment(yosys_bin: &Path) -> Option<PathBuf> {
    yosys_bin
        .parent()
        .and_then(Path::parent)
        .map(|root| root.join("environment.bat"))
        .filter(|path| path.is_file())
}

#[cfg(target_os = "windows")]
fn spawn_windows_yosys_process(
    environment_batch: &Path,
    yosys_bin: &Path,
    script_path: &Path,
    workdir: &Path,
) -> std::io::Result<std::process::Child> {
    let script_argument = resolve_windows_script_argument(script_path, workdir);
    let mut command = Command::new("cmd");
    command
        .arg("/d")
        .arg("/c")
        .raw_arg(format!(
            "call {} >nul 2>nul & {} -s {}",
            quote_windows_cmd_path(environment_batch),
            quote_windows_cmd_path(yosys_bin),
            quote_windows_cmd_path(&script_argument),
        ))
        .current_dir(workdir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.spawn()
}

#[cfg(target_os = "windows")]
fn quote_windows_cmd_path(path: &Path) -> String {
    format!("\"{}\"", path.display())
}

#[cfg(target_os = "windows")]
fn resolve_windows_script_argument(script_path: &Path, workdir: &Path) -> PathBuf {
    script_path
        .strip_prefix(workdir)
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            script_path
                .file_name()
                .map(PathBuf::from)
                .unwrap_or_else(|| script_path.to_path_buf())
        })
}

pub(super) fn resolve_fde_support_file(
    app: &AppHandle,
    file_name: &str,
) -> Result<PathBuf, String> {
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
        "Unable to locate Aspen's packaged synthesis support file '{}'. Build with `src-tauri/tauri.yosys.conf.json` or keep `{}/{}` in the source tree for local development.",
        file_name, FDE_RESOURCE_DIR, file_name
    ))
}

pub(super) fn yosys_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "yosys.exe"
    } else {
        "yosys"
    }
}
