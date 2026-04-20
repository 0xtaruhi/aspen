use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{path::BaseDirectory, AppHandle, Emitter, Manager};

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
    pub root_uri: Option<String>,
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
    pub command: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct HdlLspStatusResponse {
    pub available: bool,
    pub command: Option<String>,
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
pub fn hdl_lsp_status(app: AppHandle) -> Result<HdlLspStatusResponse, String> {
    let command = resolve_slang_server_command(Some(&app));
    Ok(HdlLspStatusResponse {
        available: command.is_some(),
        command,
    })
}

#[tauri::command]
pub fn hdl_lsp_start(
    app: AppHandle,
    manager: tauri::State<'_, Arc<HdlLspManager>>,
    request: HdlLspStartRequest,
) -> Result<HdlLspStartResponse, String> {
    let command = resolve_slang_server_command(Some(&app));
    let Some(program) = command.clone() else {
        return Ok(HdlLspStartResponse {
            session_id: request.session_id,
            root_uri: "".to_string(),
            available: false,
            command: None,
        });
    };

    stop_existing_session(&manager, &request.session_id);

    let workspace_root = prepare_workspace_root(
        request.root_uri.as_deref(),
        &request.session_id,
        &request.files,
    )?;

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

    spawn_reader_thread(app, session_id.clone(), stdout, false);
    spawn_stderr_reader_thread(stderr);

    manager
        .sessions
        .lock()
        .map_err(|_| "failed to acquire HDL LSP session registry".to_string())?
        .insert(
            session_id.clone(),
            HdlLspSession {
                stdin,
                child,
                workspace_root: workspace_root.clone(),
            },
        );

    Ok(HdlLspStartResponse {
        session_id,
        root_uri: path_to_file_uri(&workspace_root)?,
        available: true,
        command,
    })
}

#[tauri::command]
pub fn hdl_lsp_forward(
    manager: tauri::State<'_, Arc<HdlLspManager>>,
    request: HdlLspForwardRequest,
) -> Result<(), String> {
    let sessions = manager
        .sessions
        .lock()
        .map_err(|_| "failed to acquire HDL LSP session registry".to_string())?;
    let session = sessions
        .get(&request.session_id)
        .ok_or_else(|| format!("unknown HDL LSP session '{}'", request.session_id))?;

    let body = serde_json::to_vec(&request.message).map_err(|err| err.to_string())?;
    let mut stdin = session
        .stdin
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
    stop_existing_session(&manager, &request.session_id);
    Ok(())
}

fn stop_existing_session(manager: &Arc<HdlLspManager>, session_id: &str) {
    let session = manager
        .sessions
        .lock()
        .ok()
        .and_then(|mut sessions| sessions.remove(session_id));

    if let Some(session) = session {
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

fn prepare_workspace_root(
    root_uri: Option<&str>,
    session_id: &str,
    files: &[HdlLspSourceFile],
) -> Result<PathBuf, String> {
    let workspace_root = match root_uri.and_then(file_uri_to_path) {
        Some(path) if path.exists() => path,
        _ => std::env::temp_dir()
            .join(DEFAULT_WORKSPACE_ROOT_NAME)
            .join(sanitize_session_id(session_id)),
    };

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

fn spawn_reader_thread<R>(app: AppHandle, session_id: String, reader: R, is_stderr: bool)
where
    R: std::io::Read + Send + 'static,
{
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);

        if is_stderr {
            let mut line = String::new();
            loop {
                line.clear();
                let Ok(bytes_read) = reader.read_line(&mut line) else {
                    break;
                };

                if bytes_read == 0 {
                    break;
                }

                let payload = HdlLspEventPayload {
                    session_id: session_id.clone(),
                    message: serde_json::json!({
                        "jsonrpc": "2.0",
                        "method": "$/logTrace",
                        "params": {
                            "message": line.trim_end_matches(['\r', '\n']),
                            "verbose": "stderr"
                        }
                    }),
                };
                let _ = app.emit(LSP_EVENT_NAME, payload);
            }

            return;
        }

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
            let Ok(bytes_read) = reader.read_line(&mut line) else {
                break;
            };

            if bytes_read == 0 {
                break;
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

fn file_uri_to_path(uri: &str) -> Option<PathBuf> {
    let stripped = uri.strip_prefix("file://")?;
    #[cfg(target_os = "windows")]
    let path = stripped.trim_start_matches('/');
    #[cfg(not(target_os = "windows"))]
    let path = stripped;
    Some(PathBuf::from(path))
}

fn path_to_file_uri(path: &Path) -> Result<String, String> {
    let absolute = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::fs::canonicalize(path).map_err(|err| err.to_string())?
    };

    let path_str = absolute.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        return Ok(format!("file:///{}", path_str.replace('\\', "/")));
    }

    #[cfg(not(target_os = "windows"))]
    {
        Ok(format!("file://{}", path_str))
    }
}

impl Drop for HdlLspSession {
    fn drop(&mut self) {
        let _ = std::fs::create_dir_all(&self.workspace_root);
    }
}
