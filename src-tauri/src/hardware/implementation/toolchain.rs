use std::path::PathBuf;

use tauri::{path::BaseDirectory, AppHandle, Manager};

use super::{
    FDE_ARCH_FILE, FDE_CIL_FILE, FDE_DC_CELL_FILE, FDE_DELAY_FILE, FDE_PACK_CELL_FILE,
    FDE_PACK_CONFIG_FILE, FDE_PACK_DCP_LIB_FILE, FDE_RESOURCE_DIR,
};

pub(super) struct ImplementationResourcePaths {
    pub dc_cell: PathBuf,
    pub pack_cell: PathBuf,
    pub pack_dcp_lib: PathBuf,
    pub pack_config: PathBuf,
    pub arch: PathBuf,
    pub delay: PathBuf,
    pub cil: PathBuf,
}

pub(super) fn resolve_resource_paths(
    app: &AppHandle,
) -> Result<ImplementationResourcePaths, String> {
    Ok(ImplementationResourcePaths {
        dc_cell: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_DC_CELL_FILE)?,
        pack_cell: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_PACK_CELL_FILE)?,
        pack_dcp_lib: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_PACK_DCP_LIB_FILE)?,
        pack_config: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_PACK_CONFIG_FILE)?,
        arch: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_ARCH_FILE)?,
        delay: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_DELAY_FILE)?,
        cil: resolve_resource_file(app, FDE_RESOURCE_DIR, FDE_CIL_FILE)?,
    })
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

    if cfg!(debug_assertions) {
        let bundled_dev_candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(root_dir)
            .join(file_name);
        if bundled_dev_candidate.is_file() {
            return Ok(bundled_dev_candidate);
        }
    }

    Err(format!(
        "Unable to locate Aspen resource '{}'.",
        PathBuf::from(root_dir).join(file_name).display()
    ))
}
