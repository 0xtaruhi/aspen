use std::{
    fs,
    path::{Component, Path, PathBuf},
};

use serde::Deserialize;
use serde::Serialize;

#[derive(Deserialize)]
pub struct ProjectSourceFileWriteRequest {
    pub relative_path: String,
    pub content: String,
}

#[derive(Serialize)]
pub struct ProjectDirectoryInspection {
    pub exists: bool,
    pub metadata_exists: bool,
    pub visible_entry_count: usize,
}

#[tauri::command]
pub fn read_project_file(path: String) -> Result<String, String> {
    fs::read_to_string(Path::new(&path)).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn write_project_file(path: String, content: String) -> Result<(), String> {
    let target = Path::new(&path);
    ensure_parent_dir(target)?;
    fs::write(target, content.as_bytes()).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn write_project_bundle(
    metadata_path: String,
    metadata_content: String,
    source_files: Vec<ProjectSourceFileWriteRequest>,
) -> Result<(), String> {
    let metadata_target = Path::new(&metadata_path);
    let project_root = metadata_target
        .parent()
        .ok_or_else(|| "Project metadata path must have a parent directory".to_string())?;
    let sources_dir = project_root.join("src");
    let output_dir = project_root.join("output");
    let internal_dir = project_root.join(".aspen");
    let staged_files = source_files
        .into_iter()
        .map(|file| {
            let relative = sanitize_relative_project_path(&file.relative_path)?;
            Ok((relative, file.content))
        })
        .collect::<Result<Vec<_>, String>>()?;

    if sources_dir.exists() {
        fs::remove_dir_all(&sources_dir).map_err(|err| err.to_string())?;
    }

    fs::create_dir_all(&sources_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&output_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&internal_dir).map_err(|err| err.to_string())?;

    for (relative, content) in staged_files {
        let target = sources_dir.join(relative);
        ensure_parent_dir(&target)?;
        fs::write(&target, content.as_bytes()).map_err(|err| err.to_string())?;
    }

    fs::write(metadata_target, metadata_content.as_bytes()).map_err(|err| err.to_string())
}

#[tauri::command]
pub fn inspect_project_directory(path: String) -> Result<ProjectDirectoryInspection, String> {
    let target = Path::new(&path);
    if !target.exists() {
        return Ok(ProjectDirectoryInspection {
            exists: false,
            metadata_exists: false,
            visible_entry_count: 0,
        });
    }

    if !target.is_dir() {
        return Err(format!("'{}' is not a directory", target.display()));
    }

    let metadata_exists = target.join("aspen.project.json").is_file();
    let mut visible_entry_count = 0usize;

    for entry in fs::read_dir(target).map_err(|err| err.to_string())? {
        let entry = entry.map_err(|err| err.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();

        if name == ".DS_Store" || name == "Thumbs.db" {
            continue;
        }

        visible_entry_count += 1;
    }

    Ok(ProjectDirectoryInspection {
        exists: true,
        metadata_exists,
        visible_entry_count,
    })
}

fn ensure_parent_dir(target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }

    Ok(())
}

fn sanitize_relative_project_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Project source path cannot be empty".to_string());
    }

    let candidate = Path::new(trimmed);
    let mut relative = PathBuf::new();

    for component in candidate.components() {
        match component {
            Component::Normal(segment) => relative.push(segment),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(format!("Invalid project source path '{}'", path));
            }
        }
    }

    if relative.as_os_str().is_empty() {
        return Err(format!("Invalid project source path '{}'", path));
    }

    Ok(relative)
}

#[cfg(test)]
mod tests {
    use super::{
        sanitize_relative_project_path, write_project_bundle, ProjectSourceFileWriteRequest,
    };
    use std::{
        env, fs,
        path::{Path, PathBuf},
        process,
        time::{SystemTime, UNIX_EPOCH},
    };

    fn unique_temp_dir(label: &str) -> PathBuf {
        let generated_at_ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        env::temp_dir().join(format!(
            "aspen-project-commands-{label}-{}-{generated_at_ns}",
            process::id()
        ))
    }

    fn write_file(path: &Path, content: &str) {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create test parent dir");
        }
        fs::write(path, content).expect("write test file");
    }

    #[test]
    fn sanitize_relative_project_path_rejects_parent_components() {
        assert!(sanitize_relative_project_path("../escape.v").is_err());
        assert!(sanitize_relative_project_path("/absolute.v").is_err());
        assert!(sanitize_relative_project_path("").is_err());
        assert_eq!(
            sanitize_relative_project_path("./src/top.v")
                .expect("sanitize relative path")
                .to_string_lossy(),
            "src/top.v"
        );
    }

    #[test]
    fn write_project_bundle_keeps_existing_sources_when_new_paths_are_invalid() {
        let project_dir = unique_temp_dir("invalid-bundle");
        let metadata_path = project_dir.join("aspen.project.json");
        let existing_source = project_dir.join("src/top.v");
        write_file(&existing_source, "module top; endmodule");

        let result = write_project_bundle(
            metadata_path.to_string_lossy().into_owned(),
            "{}".to_string(),
            vec![ProjectSourceFileWriteRequest {
                relative_path: "../escape.v".to_string(),
                content: "module escape; endmodule".to_string(),
            }],
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&existing_source).expect("read preserved source"),
            "module top; endmodule"
        );

        let _ = fs::remove_dir_all(&project_dir);
    }
}
