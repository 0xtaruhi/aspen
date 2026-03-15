mod hardware;

use std::{
    fs,
    path::Path,
    sync::{Arc, Mutex},
};

use hardware::{
    BitstreamGenerationResult, HardwareActionV1, HardwareDataStreamConfigV1,
    HardwareDataStreamStatusV1, HardwareEventReason, HardwareRuntime, HardwareStateV1,
    HardwareStatus, ImplementationReportV1, ImplementationRequestV1, SynthesisReportV1,
    SynthesisRequestV1,
};
use tauri::Emitter;
use vlfd_rs::{Device, HotplugEvent, HotplugEventKind, HotplugOptions, HotplugRegistration};

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[derive(Default)]
struct HotplugState {
    registration: Mutex<Option<HotplugRegistration>>,
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
    let registration = Device::new()
        .map_err(|err| err.to_string())?
        .usb()
        .register_hotplug_callback(opts, move |event: HotplugEvent| {
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
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(HotplugState::default()))
        .manage(Arc::new(HardwareRuntime::default()))
        .invoke_handler(tauri::generate_handler![
            greet,
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
            read_project_file,
            write_project_file,
            start_hotplug_watch,
            stop_hotplug_watch
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
