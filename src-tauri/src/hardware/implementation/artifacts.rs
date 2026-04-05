use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use crate::hardware::types::ImplementationArtifactsV1;

use super::ImplementationRequestV1;

static WORKDIR_COUNTER: AtomicU64 = AtomicU64::new(0);

pub(super) struct PlannedArtifacts {
    pub work_dir: PathBuf,
    pub constraint_path: PathBuf,
    pub edif_path: PathBuf,
    pub map_path: PathBuf,
    pub pack_path: PathBuf,
    pub place_path: PathBuf,
    pub route_path: PathBuf,
    pub sta_output_path: PathBuf,
    pub sta_report_path: PathBuf,
    pub bitstream_path: PathBuf,
    pub bitstream_sidecar_path: PathBuf,
}

pub(super) fn resolve_workdir(
    request: &ImplementationRequestV1,
    generated_at_ms: u64,
) -> Result<PathBuf, String> {
    let base_name = sanitize_file_stem(&format!("{}_{}", request.project_name, request.top_module));
    if let Some(project_dir) = request
        .project_dir
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
    {
        let workdir = PathBuf::from(project_dir)
            .join(".aspen")
            .join("fde")
            .join(base_name);
        let _ = fs::remove_dir_all(&workdir);
        fs::create_dir_all(&workdir).map_err(|err| err.to_string())?;
        return Ok(workdir);
    }

    let counter = WORKDIR_COUNTER.fetch_add(1, Ordering::Relaxed);
    let workdir = env::temp_dir().join(format!(
        "aspen-fde-{}-{}-{}",
        std::process::id(),
        generated_at_ms,
        counter
    ));
    fs::create_dir_all(&workdir).map_err(|err| err.to_string())?;
    Ok(workdir)
}

pub(super) fn plan_artifacts(
    workdir: &Path,
    request: &ImplementationRequestV1,
) -> Result<PlannedArtifacts, String> {
    let base_name = sanitize_file_stem(&format!("{}_{}", request.project_name, request.top_module));
    let output_dir = request
        .project_dir
        .as_deref()
        .map(str::trim)
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .map(|path| path.join("output"))
        .unwrap_or_else(|| workdir.to_path_buf());
    fs::create_dir_all(&output_dir).map_err(|err| err.to_string())?;

    Ok(PlannedArtifacts {
        work_dir: workdir.to_path_buf(),
        constraint_path: output_dir.join(format!("{}_cons.xml", base_name)),
        edif_path: workdir.join(format!("{}_syn.edf", base_name)),
        map_path: workdir.join(format!("{}_map.xml", base_name)),
        pack_path: workdir.join(format!("{}_pack.xml", base_name)),
        place_path: workdir.join(format!("{}_place.xml", base_name)),
        route_path: workdir.join(format!("{}_route.xml", base_name)),
        sta_output_path: workdir.join(format!("{}_sta.xml", base_name)),
        sta_report_path: output_dir.join(format!("{}_sta.rpt", base_name)),
        bitstream_path: output_dir.join(format!("{}_bit.bit", base_name)),
        bitstream_sidecar_path: output_dir.join(format!("{}_bit.sidecar.txt", base_name)),
    })
}

impl PlannedArtifacts {
    pub(super) fn to_snapshot(&self) -> ImplementationArtifactsV1 {
        ImplementationArtifactsV1 {
            work_dir: self.work_dir.to_string_lossy().to_string(),
            constraint_path: self.constraint_path.to_string_lossy().to_string(),
            edif_path: self
                .edif_path
                .is_file()
                .then(|| self.edif_path.to_string_lossy().to_string()),
            map_path: self
                .map_path
                .is_file()
                .then(|| self.map_path.to_string_lossy().to_string()),
            pack_path: self
                .pack_path
                .is_file()
                .then(|| self.pack_path.to_string_lossy().to_string()),
            place_path: self
                .place_path
                .is_file()
                .then(|| self.place_path.to_string_lossy().to_string()),
            route_path: self
                .route_path
                .is_file()
                .then(|| self.route_path.to_string_lossy().to_string()),
            sta_output_path: self
                .sta_output_path
                .is_file()
                .then(|| self.sta_output_path.to_string_lossy().to_string()),
            sta_report_path: self
                .sta_report_path
                .is_file()
                .then(|| self.sta_report_path.to_string_lossy().to_string()),
            bitstream_path: self
                .bitstream_path
                .is_file()
                .then(|| self.bitstream_path.to_string_lossy().to_string()),
        }
    }
}

fn sanitize_file_stem(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();

    if sanitized.trim_matches('_').is_empty() {
        "design".to_string()
    } else {
        sanitized
    }
}

#[cfg(test)]
pub(super) fn path_argument(path: &Path, workdir: &Path) -> Result<String, String> {
    if let Ok(relative) = path.strip_prefix(workdir) {
        let rendered = relative.to_string_lossy().replace('\\', "/");
        if !rendered.is_empty() {
            return Ok(rendered);
        }
    }

    if path.is_absolute() {
        return Ok(path.to_string_lossy().to_string());
    }

    let absolute = workdir.join(path);
    Ok(absolute.to_string_lossy().to_string())
}
