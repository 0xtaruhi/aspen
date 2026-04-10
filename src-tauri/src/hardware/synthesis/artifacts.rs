use std::{
    env, fs,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use crate::hardware::types::{SynthesisArtifactsV1, SynthesisRequestV1, SynthesisSourceFileV1};

use super::SYNTHESIS_ARTIFACT_FLOW_REVISION;

static WORKDIR_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(super) struct PlannedSynthesisArtifacts {
    pub work_dir: PathBuf,
    pub script_path: PathBuf,
    pub netlist_path: PathBuf,
    pub edif_path: PathBuf,
}

pub(super) fn write_source_file(
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

pub(super) fn sanitize_source_path(path: &str, index: usize) -> PathBuf {
    let mut sanitized = PathBuf::new();
    for (component_index, component) in Path::new(path).components().enumerate() {
        if let Component::Normal(part) = component {
            let raw = part.to_string_lossy();
            sanitized.push(sanitize_path_component(
                &raw,
                &format!("part_{}_{}", index, component_index),
            ));
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

pub(super) fn plan_synthesis_artifacts(
    workdir: &Path,
    request: &SynthesisRequestV1,
) -> PlannedSynthesisArtifacts {
    let project_name = request
        .project_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("project");
    let base_name = sanitize_file_stem(&format!("{}_{}", project_name, request.top_module));

    PlannedSynthesisArtifacts {
        work_dir: workdir.to_path_buf(),
        script_path: workdir.join(format!("{}_synth.ys", base_name)),
        netlist_path: workdir.join(format!("{}_netlist.json", base_name)),
        edif_path: workdir.join(format!("{}_syn.edf", base_name)),
    }
}

impl PlannedSynthesisArtifacts {
    pub(super) fn to_snapshot(&self) -> SynthesisArtifactsV1 {
        SynthesisArtifactsV1 {
            work_dir: self.work_dir.to_string_lossy().to_string(),
            script_path: self
                .script_path
                .is_file()
                .then(|| self.script_path.to_string_lossy().to_string()),
            netlist_json_path: self
                .netlist_path
                .is_file()
                .then(|| self.netlist_path.to_string_lossy().to_string()),
            edif_path: self
                .edif_path
                .is_file()
                .then(|| self.edif_path.to_string_lossy().to_string()),
            flow_revision: Some(SYNTHESIS_ARTIFACT_FLOW_REVISION.to_string()),
        }
    }
}

pub(super) fn resolve_workdir(
    request: &SynthesisRequestV1,
    timestamp_ms: u64,
) -> Result<(PathBuf, bool), String> {
    if let Some(project_dir) = request
        .project_dir
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let project_name = request
            .project_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or("project");
        let base_name = sanitize_file_stem(&format!("{}_{}", project_name, request.top_module));
        let workdir = PathBuf::from(project_dir)
            .join(".aspen")
            .join("synthesis")
            .join(base_name);
        let _ = fs::remove_dir_all(&workdir);
        fs::create_dir_all(&workdir).map_err(|err| err.to_string())?;
        return Ok((workdir, false));
    }

    let counter = WORKDIR_COUNTER.fetch_add(1, Ordering::Relaxed);
    let candidate = env::temp_dir().join(format!(
        "aspen-yosys-{}-{}-{}",
        std::process::id(),
        timestamp_ms,
        counter
    ));
    fs::create_dir_all(&candidate).map_err(|err| err.to_string())?;
    Ok((candidate, true))
}

pub(super) fn quote_yosys_path(path: &Path) -> String {
    format!(
        "\"{}\"",
        path.to_string_lossy()
            .replace('\\', "/")
            .replace('"', "\\\"")
    )
}

pub(super) fn quote_yosys_workdir_path(workdir: &Path, path: &Path) -> String {
    quote_yosys_path(path.strip_prefix(workdir).unwrap_or(path))
}

fn sanitize_file_stem(value: &str) -> String {
    let mut sanitized = String::with_capacity(value.len());
    for character in value.chars() {
        if character.is_ascii_alphanumeric() || character == '-' || character == '_' {
            sanitized.push(character);
        } else if !sanitized.ends_with('_') {
            sanitized.push('_');
        }
    }

    let trimmed = sanitized.trim_matches('_');
    if trimmed.is_empty() {
        "artifact".to_string()
    } else {
        trimmed.to_string()
    }
}

fn sanitize_path_component(value: &str, fallback: &str) -> String {
    let path = Path::new(value);
    let stem = path
        .file_stem()
        .and_then(|stem| stem.to_str())
        .unwrap_or(value);
    let extension = path.extension().and_then(|extension| extension.to_str());
    let sanitized_stem = sanitize_file_stem_with_fallback(stem, fallback);
    let sanitized_extension = extension
        .map(|extension| {
            extension
                .chars()
                .filter(|character| character.is_ascii_alphanumeric())
                .collect::<String>()
        })
        .filter(|extension| !extension.is_empty());

    match sanitized_extension {
        Some(extension) => format!("{sanitized_stem}.{extension}"),
        None => sanitized_stem,
    }
}

fn sanitize_file_stem_with_fallback(value: &str, fallback: &str) -> String {
    let sanitized = sanitize_file_stem(value);
    if sanitized == "artifact" && !value.trim().is_empty() {
        fallback.to_string()
    } else {
        sanitized
    }
}
