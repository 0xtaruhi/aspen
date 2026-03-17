use std::{
    env,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use tauri::{path::BaseDirectory, AppHandle, Manager};

use super::{
    BUNDLED_FDE_DIR, FDE_ARCH_FILE, FDE_CIL_FILE, FDE_DC_CELL_FILE, FDE_DELAY_FILE,
    FDE_PACK_CELL_FILE, FDE_PACK_CONFIG_FILE, FDE_PACK_DCP_LIB_FILE, FDE_RESOURCE_DIR,
    FDE_STA_ICLIB_FILE,
};

pub(super) struct ImplementationToolchainPaths {
    pub fde_bin_dir: PathBuf,
    pub fde_lib_dir: Option<PathBuf>,
    pub dc_cell: PathBuf,
    pub pack_cell: PathBuf,
    pub pack_dcp_lib: PathBuf,
    pub pack_config: PathBuf,
    pub sta_iclib: PathBuf,
    pub arch: PathBuf,
    pub delay: PathBuf,
    pub cil: PathBuf,
}

pub(super) fn resolve_toolchain_paths(
    app: &AppHandle,
) -> Result<ImplementationToolchainPaths, String> {
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

pub(super) fn spawn_fde_process(
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

pub(super) fn fde_executable_name(name: &str) -> String {
    if cfg!(target_os = "windows") {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}
