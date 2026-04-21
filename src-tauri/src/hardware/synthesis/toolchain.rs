use std::{
    env, fs,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

use tauri::{path::BaseDirectory, AppHandle, Manager};

use super::{BUNDLED_YOSYS_DIR, FDE_RESOURCE_DIR};

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(super) struct SynthesisToolchainPaths<'a> {
    pub yosys_bin: &'a Path,
    pub fde_simlib: &'a Path,
    pub fde_bram_lib: &'a Path,
    pub fde_bram_map: &'a Path,
    pub fde_techmap: &'a Path,
    pub fde_cells_map: &'a Path,
}

pub(super) fn resolve_yosys_binary(app: &AppHandle) -> Result<PathBuf, String> {
    for relative_path in bundled_yosys_relative_paths() {
        let bundled_resource_candidate = app
            .path()
            .resolve(
                format!("{}/{}", BUNDLED_YOSYS_DIR, relative_path),
                BaseDirectory::Resource,
            )
            .ok()
            .filter(|path| path.is_file());
        if let Some(candidate) = bundled_resource_candidate {
            return Ok(candidate);
        }
    }

    if cfg!(debug_assertions) {
        let bundle_root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(BUNDLED_YOSYS_DIR);
        if let Some(candidate) = resolve_bundled_yosys_binary_from_root(&bundle_root) {
            return Ok(candidate);
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
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);
    configure_yosys_runtime_env(&mut command, toolchain.yosys_bin);
    command.spawn()
}

pub(super) fn resolve_bundled_yosys_binary_from_root(bundle_root: &Path) -> Option<PathBuf> {
    bundled_yosys_relative_paths()
        .iter()
        .map(|relative_path| bundle_root.join(relative_path))
        .find(|candidate| candidate.is_file())
}

pub(super) fn configure_yosys_runtime_env(command: &mut Command, yosys_bin: &Path) {
    let Some(executable_dir) = yosys_bin.parent() else {
        return;
    };

    let Some(bundle_root) = executable_dir.parent() else {
        return;
    };

    let mut runtime_entries = Vec::new();
    for candidate in [
        executable_dir.to_path_buf(),
        bundle_root.join("libexec"),
        bundle_root.join("bin"),
    ] {
        if candidate.is_dir() && !runtime_entries.contains(&candidate) {
            runtime_entries.push(candidate);
        }
    }

    let existing_entries = env::var_os("PATH")
        .map(|value| env::split_paths(&value).collect::<Vec<_>>())
        .unwrap_or_default();
    runtime_entries.extend(existing_entries);

    if let Ok(path) = env::join_paths(runtime_entries) {
        command.env("PATH", path);
    }

    #[cfg(target_os = "linux")]
    {
        let mut library_entries = Vec::new();
        for candidate in [bundle_root.join("lib"), bundle_root.join("lib64")] {
            if candidate.is_dir() {
                library_entries.push(candidate);
            }
        }

        let existing_entries = env::var_os("LD_LIBRARY_PATH")
            .map(|value| env::split_paths(&value).collect::<Vec<_>>())
            .unwrap_or_default();
        library_entries.extend(existing_entries);

        if let Ok(path) = env::join_paths(library_entries) {
            command.env("LD_LIBRARY_PATH", path);
        }

        let ghdl_prefix = bundle_root.join("lib").join("ghdl");
        if ghdl_prefix.is_dir() {
            command.env("GHDL_PREFIX", ghdl_prefix);
        }

        if let Some(tcl_library) = find_prefixed_directory(&bundle_root.join("lib"), "tcl") {
            command.env("TCL_LIBRARY", tcl_library);
        }

        if let Some(tk_library) = find_prefixed_directory(&bundle_root.join("lib"), "tk") {
            command.env("TK_LIBRARY", tk_library);
        }
    }
}

fn find_prefixed_directory(root: &Path, prefix: &str) -> Option<PathBuf> {
    let mut candidates = fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            if !file_type.is_dir() {
                return None;
            }

            let name = entry.file_name();
            let name = name.to_str()?;
            if !name.starts_with(prefix) {
                return None;
            }

            Some(entry.path())
        })
        .collect::<Vec<_>>();
    candidates.sort();
    candidates.pop()
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

#[cfg(target_os = "linux")]
fn bundled_yosys_relative_paths() -> &'static [&'static str] {
    &["libexec/yosys", "bin/yosys"]
}

#[cfg(target_os = "windows")]
fn bundled_yosys_relative_paths() -> &'static [&'static str] {
    &["bin/yosys.exe"]
}

#[cfg(all(not(target_os = "linux"), not(target_os = "windows")))]
fn bundled_yosys_relative_paths() -> &'static [&'static str] {
    &["bin/yosys"]
}
