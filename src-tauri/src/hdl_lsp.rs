use std::{
    collections::HashMap,
    io::{BufRead, BufReader, ErrorKind, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};
use url::Url;

const LSP_EVENT_NAME: &str = "hdl:lsp-message";
const DEFAULT_WORKSPACE_ROOT_NAME: &str = "aspen-hdl-lsp";
const BUNDLED_SLANG_SERVER_DIR: &str = "vendor/slang-server";

#[derive(Debug, Clone, Deserialize)]
pub struct HdlLspSourceFile {
    pub path: String,
    pub content: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HdlLspStartRequest {
    pub session_id: String,
    pub files: Vec<HdlLspSourceFile>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HdlLspForwardRequest {
    pub session_id: String,
    pub message: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HdlLspStopRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct HdlLspStartResponse {
    pub session_id: String,
    pub root_uri: String,
    pub available: bool,
}

#[derive(Debug, Clone, Serialize)]
struct HdlLspEventPayload {
    session_id: String,
    message: Value,
}

#[derive(Debug)]
struct HdlLspSession {
    stdin: Arc<Mutex<ChildStdin>>,
    child: Arc<Mutex<Child>>,
    workspace_root: PathBuf,
}

#[derive(Default)]
pub struct HdlLspManager {
    sessions: Mutex<HashMap<String, HdlLspSession>>,
}

#[tauri::command]
pub fn hdl_lsp_start(
    app: AppHandle,
    manager: tauri::State<'_, Arc<HdlLspManager>>,
    request: HdlLspStartRequest,
) -> Result<HdlLspStartResponse, String> {
    let Some(program) = resolve_slang_server_command(Some(&app)) else {
        return Ok(HdlLspStartResponse {
            session_id: request.session_id,
            root_uri: "".to_string(),
            available: false,
        });
    };

    stop_existing_session(&manager, &request.session_id)?;

    let workspace_root = prepare_workspace_root(&request.session_id, &request.files)?;

    let mut child = Command::new(&program)
        .current_dir(&workspace_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("failed to spawn slang-server: {err}"))?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "failed to acquire slang-server stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "failed to acquire slang-server stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "failed to acquire slang-server stderr".to_string())?;

    let child = Arc::new(Mutex::new(child));
    let stdin = Arc::new(Mutex::new(stdin));
    let session_id = request.session_id.clone();

    if let Err(err) = manager
        .sessions
        .lock()
        .map_err(|_| "failed to acquire HDL LSP session registry".to_string())
        .map(|mut sessions| {
            sessions.insert(
                session_id.clone(),
                HdlLspSession {
                    stdin: stdin.clone(),
                    child: child.clone(),
                    workspace_root: workspace_root.clone(),
                },
            );
        })
    {
        let cleanup_result = cleanup_startup_resources(&child, &workspace_root);
        return Err(match cleanup_result {
            Ok(()) => err,
            Err(cleanup_err) => format!("{err}; cleanup failed: {cleanup_err}"),
        });
    }

    spawn_reader_thread(app, session_id.clone(), stdout);
    spawn_stderr_reader_thread(stderr);

    Ok(HdlLspStartResponse {
        session_id,
        root_uri: path_to_file_uri(&workspace_root)?,
        available: true,
    })
}

#[tauri::command]
pub fn hdl_lsp_forward(
    manager: tauri::State<'_, Arc<HdlLspManager>>,
    request: HdlLspForwardRequest,
) -> Result<(), String> {
    let stdin = {
        let sessions = manager
            .sessions
            .lock()
            .map_err(|_| "failed to acquire HDL LSP session registry".to_string())?;
        sessions
            .get(&request.session_id)
            .ok_or_else(|| format!("unknown HDL LSP session '{}'", request.session_id))?
            .stdin
            .clone()
    };

    let body = serde_json::to_vec(&request.message).map_err(|err| err.to_string())?;
    let mut stdin = stdin
        .lock()
        .map_err(|_| "failed to acquire HDL LSP stdin".to_string())?;

    write!(stdin, "Content-Length: {}\r\n\r\n", body.len()).map_err(|err| err.to_string())?;
    stdin.write_all(&body).map_err(|err| err.to_string())?;
    stdin.flush().map_err(|err| err.to_string())
}

#[tauri::command]
pub fn hdl_lsp_stop(
    manager: tauri::State<'_, Arc<HdlLspManager>>,
    request: HdlLspStopRequest,
) -> Result<(), String> {
    stop_existing_session(&manager, &request.session_id)
}

fn stop_existing_session(manager: &Arc<HdlLspManager>, session_id: &str) -> Result<(), String> {
    let session = manager
        .sessions
        .lock()
        .map_err(|_| "failed to acquire HDL LSP session registry".to_string())?
        .remove(session_id);

    if let Some(session) = session {
        stop_child_process(&session.child)?;
        remove_workspace_root(&session.workspace_root)?;
    }

    Ok(())
}

fn prepare_workspace_root(session_id: &str, files: &[HdlLspSourceFile]) -> Result<PathBuf, String> {
    let workspace_root = std::env::temp_dir()
        .join(DEFAULT_WORKSPACE_ROOT_NAME)
        .join(sanitize_session_id(session_id));

    remove_workspace_root(&workspace_root)?;

    std::fs::create_dir_all(&workspace_root).map_err(|err| err.to_string())?;

    for file in files {
        let relative = sanitize_relative_project_path(&file.path)?;
        let target = workspace_root.join(relative);
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        std::fs::write(&target, file.content.as_bytes()).map_err(|err| err.to_string())?;
    }

    Ok(workspace_root)
}

fn sanitize_relative_project_path(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("HDL LSP file path cannot be empty".to_string());
    }

    let mut relative = PathBuf::new();
    for component in Path::new(trimmed).components() {
        match component {
            std::path::Component::Normal(segment) => relative.push(segment),
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir
            | std::path::Component::RootDir
            | std::path::Component::Prefix(_) => {
                return Err(format!("Invalid HDL LSP file path '{path}'"));
            }
        }
    }

    if relative.as_os_str().is_empty() {
        return Err(format!("Invalid HDL LSP file path '{path}'"));
    }

    Ok(relative)
}

fn cleanup_startup_resources(
    child: &Arc<Mutex<Child>>,
    workspace_root: &Path,
) -> Result<(), String> {
    stop_child_process(child)?;
    remove_workspace_root(workspace_root)
}

fn stop_child_process(child: &Arc<Mutex<Child>>) -> Result<(), String> {
    let mut child = child
        .lock()
        .map_err(|_| "failed to acquire HDL LSP child handle".to_string())?;

    match child.kill() {
        Ok(()) => {}
        Err(err) if err.kind() == ErrorKind::InvalidInput => {}
        Err(err) => return Err(format!("failed to kill slang-server: {err}")),
    }

    child
        .wait()
        .map_err(|err| format!("failed to wait for slang-server exit: {err}"))?;

    Ok(())
}

fn remove_workspace_root(workspace_root: &Path) -> Result<(), String> {
    match std::fs::remove_dir_all(workspace_root) {
        Ok(()) => Ok(()),
        Err(err) if err.kind() == ErrorKind::NotFound => Ok(()),
        Err(err) => Err(format!(
            "failed to remove workspace '{}': {err}",
            workspace_root.display()
        )),
    }
}

fn sanitize_session_id(session_id: &str) -> String {
    let trimmed = session_id.trim();
    if trimmed.is_empty() {
        return "default".to_string();
    }

    trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

fn spawn_reader_thread<R>(app: AppHandle, session_id: String, reader: R)
where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);

        loop {
            let Some(message) = read_lsp_message(&mut reader) else {
                break;
            };

            let payload = HdlLspEventPayload {
                session_id: session_id.clone(),
                message,
            };
            let _ = app.emit(LSP_EVENT_NAME, payload);
        }
    });
}

fn spawn_stderr_reader_thread<R>(reader: R)
where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        let mut line = String::new();

        loop {
            line.clear();
            let bytes_read = match reader.read_line(&mut line) {
                Ok(bytes_read) => bytes_read,
                Err(err) => {
                    eprintln!("[slang-server stderr] failed to read stderr: {err}");
                    break;
                }
            };

            if bytes_read == 0 {
                break;
            }

            let trimmed = line.trim_end();
            if !trimmed.is_empty() {
                eprintln!("[slang-server stderr] {trimmed}");
            }
        }
    });
}

fn read_lsp_message<R: BufRead>(reader: &mut R) -> Option<Value> {
    let mut content_length: Option<usize> = None;
    let mut line = String::new();

    loop {
        line.clear();
        let bytes_read = reader.read_line(&mut line).ok()?;
        if bytes_read == 0 {
            return None;
        }

        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }

        if let Some((name, value)) = trimmed.split_once(':') {
            if name.eq_ignore_ascii_case("Content-Length") {
                content_length = value.trim().parse::<usize>().ok();
            }
        }
    }

    let content_length = content_length?;
    let mut body = vec![0; content_length];
    reader.read_exact(&mut body).ok()?;
    serde_json::from_slice(&body).ok()
}

fn resolve_slang_server_command(app: Option<&AppHandle>) -> Option<String> {
    if let Ok(explicit) = std::env::var("ASPEN_SLANG_SERVER") {
        let trimmed = explicit.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }

    if let Some(candidate) = app.and_then(find_bundled_slang_server_resource_path) {
        return Some(candidate);
    }

    if let Some(candidate) = find_bundled_dev_slang_server_path() {
        return Some(candidate);
    }

    which("slang-server")
}

fn which(program: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for candidate in std::env::split_paths(&path) {
        let full = candidate.join(program);
        if full.is_file() {
            return Some(full.to_string_lossy().into_owned());
        }

        #[cfg(target_os = "windows")]
        {
            let full_exe = candidate.join(format!("{program}.exe"));
            if full_exe.is_file() {
                return Some(full_exe.to_string_lossy().into_owned());
            }
        }
    }

    None
}

fn find_bundled_slang_server_resource_path(app: &AppHandle) -> Option<String> {
    app.path()
        .resolve(
            format!(
                "{}/{}",
                BUNDLED_SLANG_SERVER_DIR,
                slang_server_executable_name()
            ),
            BaseDirectory::Resource,
        )
        .ok()
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned())
}

fn find_bundled_dev_slang_server_path() -> Option<String> {
    let candidate = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join(BUNDLED_SLANG_SERVER_DIR)
        .join(slang_server_executable_name());

    candidate
        .is_file()
        .then(|| candidate.to_string_lossy().into_owned())
}

fn slang_server_executable_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "slang-server.exe"
    } else {
        "slang-server"
    }
}

fn path_to_file_uri(path: &Path) -> Result<String, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::fs::canonicalize(path).map_err(|err| err.to_string())?
    };

    Url::from_file_path(&absolute)
        .map(|url| url.to_string())
        .map_err(|_| format!("failed to convert '{}' to a file URI", absolute.display()))
}
