use std::{
    env,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use tauri::{path::BaseDirectory, AppHandle, Manager};

use super::{BUNDLED_YOSYS_DIR, FDE_RESOURCE_DIR};

pub(super) struct SynthesisToolchainPaths<'a> {
    pub yosys_bin: &'a Path,
    pub yosys_env: Option<PathBuf>,
    pub fde_simlib: &'a Path,
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

pub(super) fn resolve_yosys_environment(yosys_bin: &Path) -> Option<PathBuf> {
    if !cfg!(target_os = "windows") {
        return None;
    }

    yosys_bin
        .parent()
        .and_then(Path::parent)
        .map(|root| root.join("environment.bat"))
        .filter(|path| path.is_file())
}

pub(super) fn spawn_yosys_process(
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
        "Unable to locate Aspen's bundled FDE synthesis support file '{}'. Build with `src-tauri/tauri.yosys.conf.json` or keep `{}/{}` in the source tree for local development.",
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
