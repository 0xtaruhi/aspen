mod app_appearance;
#[cfg(target_os = "macos")]
mod app_menu;
mod app_update;
mod hardware;

use std::{
    fs,
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};

use hardware::{
    BitstreamGenerationResult, HardwareActionV1, HardwareDataStreamConfigV1,
    HardwareDataStreamStatusV1, HardwareEventReason, HardwareRuntime, HardwareStateV1,
    HardwareStatus, ImplementationReportV1, ImplementationRequestV1, SynthesisReportV1,
    SynthesisRequestV1,
};
use serde::Deserialize;
use serde::Serialize;
use tauri::Emitter;
use vlfd_rs::{HotplugEvent, HotplugEventKind, HotplugOptions, HotplugRegistration, Probe};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Default)]
struct HotplugState {
    registration: Mutex<Option<HotplugRegistration>>,
}

#[derive(Deserialize)]
struct ProjectSourceFileWriteRequest {
    relative_path: String,
    content: String,
}

#[derive(Serialize)]
struct ProjectDirectoryInspection {
    exists: bool,
    metadata_exists: bool,
    visible_entry_count: usize,
}

#[tauri::command]
async fn hardware_get_state(
    runtime: tauri::State<'_, Arc<HardwareRuntime>>,
) -> Result<HardwareStateV1, String> {
    runtime.snapshot()
}

#[tauri::command]
async fn hardware_dispatch(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Arc<HardwareRuntime>>,
    action: HardwareActionV1,
) -> Result<HardwareStateV1, String> {
    runtime
        .dispatch(&app, action, HardwareEventReason::Action)
        .await
}

#[tauri::command]
fn hardware_get_data_stream_status(
    runtime: tauri::State<'_, Arc<HardwareRuntime>>,
) -> Result<HardwareDataStreamStatusV1, String> {
    runtime.data_stream_status()
}

#[tauri::command]
fn start_hardware_data_stream(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Arc<HardwareRuntime>>,
) -> Result<(), String> {
    runtime.inner().start_data_stream(&app)
}

#[tauri::command]
fn stop_hardware_data_stream(
    runtime: tauri::State<'_, Arc<HardwareRuntime>>,
) -> Result<(), String> {
    runtime.stop_data_stream()
}

#[tauri::command]
fn configure_hardware_data_stream(
    runtime: tauri::State<'_, Arc<HardwareRuntime>>,
    config: HardwareDataStreamConfigV1,
) -> Result<HardwareDataStreamStatusV1, String> {
    runtime.configure_data_stream(config)
}

#[tauri::command]
fn set_hardware_data_stream_rate(
    runtime: tauri::State<'_, Arc<HardwareRuntime>>,
    rate_hz: f64,
) -> Result<HardwareDataStreamStatusV1, String> {
    runtime.set_data_stream_rate(rate_hz)
}

#[tauri::command]
async fn get_hardware_status(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Arc<HardwareRuntime>>,
) -> Result<HardwareStatus, String> {
    let state = runtime
        .dispatch(&app, HardwareActionV1::Probe, HardwareEventReason::Action)
        .await?;

    HardwareStatus::from_state(&state)
        .ok_or_else(|| "No connected hardware device found".to_string())
}

#[tauri::command]
async fn program_bitstream(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Arc<HardwareRuntime>>,
    bitstream_path: String,
) -> Result<(), String> {
    runtime
        .dispatch(
            &app,
            HardwareActionV1::ProgramBitstream {
                bitstream_path: Some(bitstream_path),
            },
            HardwareEventReason::Action,
        )
        .await
        .map(|_| ())
}

#[tauri::command]
async fn generate_bitstream(
    app: tauri::AppHandle,
    runtime: tauri::State<'_, Arc<HardwareRuntime>>,
    source_name: String,
    source_code: String,
    output_path: Option<String>,
) -> Result<BitstreamGenerationResult, String> {
    let state = runtime
        .dispatch(
            &app,
            HardwareActionV1::GenerateBitstream {
                source_name,
                source_code,
                output_path,
            },
            HardwareEventReason::Action,
        )
        .await?;

    state
        .artifact
        .map(|artifact| BitstreamGenerationResult {
            path: artifact.path,
            bytes: artifact.bytes,
        })
        .ok_or_else(|| "Bitstream generation completed without an artifact".to_string())
}

#[tauri::command]
async fn run_yosys_synthesis(
    app: tauri::AppHandle,
    request: SynthesisRequestV1,
) -> Result<SynthesisReportV1, String> {
    tauri::async_runtime::spawn_blocking(move || hardware::run_yosys_synthesis(&app, request))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
async fn run_fde_implementation(
    app: tauri::AppHandle,
    request: ImplementationRequestV1,
) -> Result<ImplementationReportV1, String> {
    tauri::async_runtime::spawn_blocking(move || hardware::run_fde_implementation(&app, request))
        .await
        .map_err(|err| err.to_string())?
}

#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    fs::read_to_string(Path::new(&path)).map_err(|err| err.to_string())
}

#[tauri::command]
fn write_project_file(path: String, content: String) -> Result<(), String> {
    let target = Path::new(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
    }
    fs::write(target, content.as_bytes()).map_err(|err| err.to_string())
}

#[tauri::command]
fn write_project_bundle(
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

    if sources_dir.exists() {
        fs::remove_dir_all(&sources_dir).map_err(|err| err.to_string())?;
    }

    fs::create_dir_all(&sources_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&output_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&internal_dir).map_err(|err| err.to_string())?;

    for file in source_files {
        let relative = sanitize_relative_project_path(&file.relative_path)?;
        let target = sources_dir.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|err| err.to_string())?;
        }
        fs::write(&target, file.content.as_bytes()).map_err(|err| err.to_string())?;
    }

    fs::write(metadata_target, metadata_content.as_bytes()).map_err(|err| err.to_string())
}

#[tauri::command]
fn inspect_project_directory(path: String) -> Result<ProjectDirectoryInspection, String> {
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

#[tauri::command]
fn start_hotplug_watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, Arc<HotplugState>>,
    runtime: tauri::State<'_, Arc<HardwareRuntime>>,
) -> Result<(), String> {
    let mut guard = state
        .registration
        .lock()
        .map_err(|_| "failed to acquire hotplug mutex".to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let opts = HotplugOptions {
        vendor_id: None,
        product_id: None,
        class_code: None,
        enumerate: true,
    };

    let handle = app.clone();
    let runtime_handle = runtime.inner().clone();
    let registration = Probe::new()
        .watch(opts, move |event: HotplugEvent| {
            let event_kind = match event.kind {
                HotplugEventKind::Arrived => "arrived",
                HotplugEventKind::Left => "left",
            };
            let payload = serde_json::json!({
                "kind": event_kind,
                "device": {
                    "bus": event.device.bus_number,
                    "address": event.device.address,
                    "vendorId": event.device.vendor_id,
                    "productId": event.device.product_id,
                }
            });
            let _ = handle.emit("hardware:hotplug", payload);

            let app_for_task = handle.clone();
            let runtime_for_task = runtime_handle.clone();
            let is_left = event_kind == "left";
            tauri::async_runtime::spawn(async move {
                if is_left {
                    let _ = runtime_for_task
                        .mark_device_disconnected(&app_for_task, HardwareEventReason::Hotplug);
                    return;
                }

                let _ = runtime_for_task
                    .dispatch(
                        &app_for_task,
                        HardwareActionV1::Probe,
                        HardwareEventReason::Hotplug,
                    )
                    .await;
            });
        })
        .map_err(|err| err.to_string())?;

    *guard = Some(registration);
    Ok(())
}

#[tauri::command]
fn stop_hotplug_watch(state: tauri::State<'_, Arc<HotplugState>>) -> Result<(), String> {
    let mut guard = state
        .registration
        .lock()
        .map_err(|_| "failed to acquire hotplug mutex".to_string())?;
    *guard = None;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hardware_runtime = Arc::new(HardwareRuntime::default());
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_liquid_glass::init())
        .setup({
            let hardware_runtime = Arc::clone(&hardware_runtime);
            move |app| {
                let app_handle = app.handle().clone();
                hardware_runtime.attach_app_handle(app_handle.clone());
                app_appearance::configure_window_material(&app_handle);
                Ok(())
            }
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_updater::Builder::new()
                .pubkey(app_update::UPDATE_PUBLIC_KEY.trim())
                .build(),
        )
        .manage(Arc::new(app_update::PendingUpdateState::default()))
        .manage(Arc::new(HotplugState::default()))
        .manage(hardware_runtime)
        .invoke_handler(tauri::generate_handler![
            greet,
            app_update::app_get_update_capability,
            app_update::app_check_for_updates,
            app_update::app_install_update,
            hardware_get_state,
            hardware_dispatch,
            hardware_get_data_stream_status,
            start_hardware_data_stream,
            stop_hardware_data_stream,
            configure_hardware_data_stream,
            set_hardware_data_stream_rate,
            get_hardware_status,
            program_bitstream,
            generate_bitstream,
            run_yosys_synthesis,
            run_fde_implementation,
            app_appearance::app_get_system_theme,
            app_appearance::app_set_window_appearance,
            read_project_file,
            write_project_file,
            write_project_bundle,
            inspect_project_directory,
            start_hotplug_watch,
            stop_hotplug_watch
        ]);

    #[cfg(target_os = "macos")]
    let builder = builder
        .menu(app_menu::build_app_menu)
        .on_menu_event(|app, event| {
            if let Some(action) = app_menu::menu_action_for_id(event.id().as_ref()) {
                let _ = app.emit("aspen://menu-action", action);
            }
        });

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
