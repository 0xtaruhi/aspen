use std::{fs, sync::Arc};

use fde::{
    load_map_input, run_bitgen, run_map, run_pack, run_place, run_sta, BitgenOptions, Design,
    PlaceMode, PlaceOptions, RouteOptions, StaArtifact, StaOptions,
};

use super::super::types::ImplementationPlaceModeV1;
use super::artifacts::PlannedArtifacts;
use super::toolchain::ImplementationResourcePaths;

const FDE_FAMILY_NAME: &str = "fdp3";
const FDE_DEFAULT_LUT_SIZE: usize = 4;
const FDE_DEFAULT_PACK_CAPACITY: usize = 4;
const FDE_DEFAULT_PLACE_SEED: u64 = 1;

pub(super) fn run_map_stage(
    resource_paths: &ImplementationResourcePaths,
    artifacts: &PlannedArtifacts,
) -> Result<(Design, fde::StageReport), String> {
    let mut result = run_map(
        load_map_input(&artifacts.edif_path).map_err(|err| err.to_string())?,
        &fde::MapOptions {
            lut_size: FDE_DEFAULT_LUT_SIZE,
            cell_library: Some(resource_paths.dc_cell.clone()),
            emit_structural_verilog: false,
        },
    )
    .map_err(|err| err.to_string())?;
    fde::io::save_design(&result.value.design, &artifacts.map_path)
        .map_err(|err| err.to_string())?;
    result.report.artifact("design", &artifacts.map_path);
    Ok((result.value.design, result.report))
}

pub(super) fn run_pack_stage(
    resource_paths: &ImplementationResourcePaths,
    design: Design,
    artifacts: &PlannedArtifacts,
) -> Result<(Design, fde::StageReport), String> {
    let mut result = run_pack(
        design,
        &fde::PackOptions {
            family: Some(FDE_FAMILY_NAME.to_string()),
            capacity: FDE_DEFAULT_PACK_CAPACITY,
            cell_library: Some(resource_paths.pack_cell.clone()),
            dcp_library: Some(resource_paths.pack_dcp_lib.clone()),
            config: Some(resource_paths.pack_config.clone()),
        },
    )
    .map_err(|err| err.to_string())?;
    fde::io::save_design(&result.value, &artifacts.pack_path).map_err(|err| err.to_string())?;
    result.report.artifact("design", &artifacts.pack_path);
    Ok((result.value, result.report))
}

pub(super) fn run_place_stage(
    place_mode: ImplementationPlaceModeV1,
    design: Design,
    artifacts: &PlannedArtifacts,
    arch: &Arc<fde::Arch>,
    delay: &Arc<fde::DelayModel>,
    constraints: &Arc<[fde::ConstraintEntry]>,
) -> Result<(Design, fde::StageReport), String> {
    let mut result = run_place(
        design,
        &PlaceOptions {
            arch: Arc::clone(arch),
            delay: Some(Arc::clone(delay)),
            constraints: Arc::clone(constraints),
            mode: place_mode_to_fde(place_mode),
            seed: FDE_DEFAULT_PLACE_SEED,
        },
    )
    .map_err(|err| err.to_string())?;
    fde::io::save_design_with_context(
        &result.value,
        &artifacts.place_path,
        &fde::io::DesignWriteContext {
            arch: Some(arch.as_ref()),
            constraints: constraints.as_ref(),
            ..fde::io::DesignWriteContext::default()
        },
    )
    .map_err(|err| err.to_string())?;
    result.report.artifact("design", &artifacts.place_path);
    Ok((result.value, result.report))
}

pub(super) fn run_route_stage(
    design: Design,
    artifacts: &PlannedArtifacts,
    resource_paths: &ImplementationResourcePaths,
    arch: &Arc<fde::Arch>,
    constraints: &Arc<[fde::ConstraintEntry]>,
    cil: &fde::Cil,
) -> Result<
    (
        Design,
        fde::DeviceDesign,
        fde::DeviceRouteImage,
        fde::StageReport,
    ),
    String,
> {
    let lowered = fde::route::lower_design(
        design.clone(),
        arch.as_ref(),
        Some(cil),
        constraints.as_ref(),
    )
    .map_err(|err| err.to_string())?;
    let mut result = fde::route::run_with_artifacts(
        design,
        &RouteOptions {
            arch: Arc::clone(arch),
            arch_path: resource_paths.arch.clone(),
            constraints: Arc::clone(constraints),
            cil: Some(cil.clone()),
            device_design: Some(lowered),
        },
    )
    .map_err(|err| err.to_string())?;

    fde::io::save_design_with_context(
        &result.value.design,
        &artifacts.route_path,
        &fde::io::DesignWriteContext {
            arch: Some(arch.as_ref()),
            cil: Some(cil),
            constraints: constraints.as_ref(),
            cil_path: Some(&resource_paths.cil),
        },
    )
    .map_err(|err| err.to_string())?;
    result.report.artifact("design", &artifacts.route_path);
    Ok((
        result.value.design,
        result.value.device_design,
        result.value.route_image,
        result.report,
    ))
}

pub(super) fn run_sta_stage(
    design: Design,
    artifacts: &PlannedArtifacts,
    arch: &Arc<fde::Arch>,
    delay: &Arc<fde::DelayModel>,
) -> Result<(StaArtifact, fde::StageReport), String> {
    let mut result = run_sta(
        design,
        &StaOptions {
            arch: Some(Arc::clone(arch)),
            delay: Some(Arc::clone(delay)),
        },
    )
    .map_err(|err| err.to_string())?;
    fde::io::save_design_with_context(
        &result.value.design,
        &artifacts.sta_output_path,
        &fde::io::DesignWriteContext {
            arch: Some(arch.as_ref()),
            ..fde::io::DesignWriteContext::default()
        },
    )
    .map_err(|err| err.to_string())?;
    fs::write(&artifacts.sta_report_path, &result.value.report_text)
        .map_err(|err| err.to_string())?;
    result.report.artifact("design", &artifacts.sta_output_path);
    result
        .report
        .artifact("timing_report", &artifacts.sta_report_path);
    Ok((result.value, result.report))
}

pub(super) fn run_bitgen_stage(
    design: Design,
    artifacts: &PlannedArtifacts,
    resource_paths: &ImplementationResourcePaths,
    arch_name: &str,
    cil: &fde::Cil,
    device_design: fde::DeviceDesign,
    route_image: fde::DeviceRouteImage,
) -> Result<fde::StageReport, String> {
    let mut result = run_bitgen(
        design,
        &BitgenOptions {
            arch_name: Some(arch_name.to_string()),
            arch_path: Some(resource_paths.arch.clone()),
            cil_path: Some(resource_paths.cil.clone()),
            cil: Some(cil.clone()),
            device_design: Some(device_design),
            route_image: Some(route_image),
        },
    )
    .map_err(|err| err.to_string())?;
    fs::write(&artifacts.bitstream_path, &result.value.bytes).map_err(|err| err.to_string())?;
    fs::write(
        &artifacts.bitstream_sidecar_path,
        &result.value.sidecar_text,
    )
    .map_err(|err| err.to_string())?;
    result
        .report
        .metric("bitstream_sha256", result.value.sha256.clone());
    result
        .report
        .artifact("bitstream", &artifacts.bitstream_path);
    result
        .report
        .artifact("sidecar", &artifacts.bitstream_sidecar_path);
    Ok(result.report)
}

#[cfg(test)]
pub(super) fn place_mode(mode: ImplementationPlaceModeV1) -> PlaceMode {
    place_mode_to_fde(mode)
}

fn place_mode_to_fde(mode: ImplementationPlaceModeV1) -> PlaceMode {
    match mode {
        ImplementationPlaceModeV1::TimingDriven => PlaceMode::TimingDriven,
        ImplementationPlaceModeV1::BoundingBox => PlaceMode::BoundingBox,
    }
}
