use std::{
    env,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

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

    if cfg!(debug_assertions) {
        let bundled_dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(BUNDLED_YOSYS_DIR)
            .join("bin")
            .join(executable_name);
        if bundled_dev_candidate.is_file() {
            return Ok(bundled_dev_candidate);
        }
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
        let lib_dir = bundle_root.join("lib");
        if lib_dir.is_dir() {
            runtime_entries.push(lib_dir);
        }

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

    if cfg!(debug_assertions) {
        let bundled_dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(FDE_RESOURCE_DIR)
            .join(file_name);
        if bundled_dev_candidate.is_file() {
            return Ok(bundled_dev_candidate);
        }
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
