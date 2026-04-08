use std::{
    fs,
    path::{Path, PathBuf},
};

use super::types::{HardwareArtifactSnapshot, HardwareDeviceSnapshot};
use vlfd_rs::{Board, Programmer};

pub fn probe_device() -> Result<HardwareDeviceSnapshot, String> {
    let board = Board::open().map_err(|err| err.to_string())?;
    let snapshot = board.config().clone().into();
    let _ = board.close();

    Ok(HardwareDeviceSnapshot {
        board: "FDP3P7".to_string(),
        description: "VLFD FPGA board (FDP3P7)".to_string(),
        config: snapshot,
    })
}

pub fn program_bitstream(bitstream_path: &str) -> Result<(), String> {
    let mut programmer = Programmer::open().map_err(|err| err.to_string())?;
    let result = programmer
        .program(Path::new(bitstream_path))
        .map_err(|err| err.to_string());
    let _ = programmer.close();
    result
}

pub fn generate_bitstream(
    source_name: &str,
    source_code: &str,
    output_path: Option<&str>,
) -> Result<HardwareArtifactSnapshot, String> {
    let output_target = resolve_output_path(source_name, output_path)?;
    if let Some(parent) = output_target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }

    let bitstream_content = format!(
        "// Aspen generated pseudo-bitstream\n// Source: {}\n// Lines: {}\n{}\n",
        source_name,
        source_code.lines().count(),
        source_code
    );

    fs::write(&output_target, bitstream_content.as_bytes()).map_err(|err| err.to_string())?;

    Ok(HardwareArtifactSnapshot {
        path: output_target.to_string_lossy().to_string(),
        bytes: bitstream_content.len(),
    })
}

fn resolve_output_path(source_name: &str, output_path: Option<&str>) -> Result<PathBuf, String> {
    if let Some(path) = output_path {
        return Ok(PathBuf::from(path));
    }

    let base_name: String = source_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect();

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|err| err.to_string())?
        .as_secs();

    Ok(PathBuf::from(format!(
        "{}_{}.bit",
        base_name.trim_end_matches(".v"),
        timestamp
    )))
}
