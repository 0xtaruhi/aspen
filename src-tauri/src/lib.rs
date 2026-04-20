mod app_appearance;
mod app_menu;
mod app_update;
mod hardware;
mod hardware_commands;
mod hdl_lsp;
mod project_commands;

use std::sync::Arc;

#[cfg(target_os = "macos")]
use tauri::Emitter;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hardware_runtime = Arc::new(hardware::HardwareRuntime::default());
    let builder = tauri::Builder::default()
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
        .manage(Arc::new(hardware_commands::HotplugState::default()))
        .manage(Arc::new(hdl_lsp::HdlLspManager::default()))
        .manage(hardware_runtime)
        .invoke_handler(tauri::generate_handler![
            app_update::app_get_update_capability,
            app_update::app_check_for_updates,
            app_update::app_install_update,
            hardware_commands::hardware_get_state,
            hardware_commands::hardware_dispatch,
            hardware_commands::hardware_get_data_stream_status,
            hardware_commands::hardware_get_waveform_snapshot,
            hardware_commands::start_hardware_data_stream,
            hardware_commands::stop_hardware_data_stream,
            hardware_commands::configure_hardware_data_stream,
            hardware_commands::set_hardware_data_stream_rate,
            hardware_commands::set_hardware_waveform_enabled,
            hardware_commands::get_hardware_status,
            hardware_commands::program_bitstream,
            hardware_commands::generate_bitstream,
            hardware_commands::run_yosys_synthesis,
            hardware_commands::run_fde_implementation,
            app_appearance::app_get_system_theme,
            app_appearance::app_set_window_appearance,
            app_menu::app_set_menu_language,
            project_commands::read_project_file,
            project_commands::write_project_file,
            project_commands::write_project_bundle,
            project_commands::inspect_project_directory,
            hdl_lsp::hdl_lsp_start,
            hdl_lsp::hdl_lsp_forward,
            hdl_lsp::hdl_lsp_stop,
            hardware_commands::start_hotplug_watch,
            hardware_commands::stop_hotplug_watch
        ]);

    let builder = attach_native_menu(builder);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(target_os = "macos")]
fn attach_native_menu(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .menu(app_menu::build_app_menu)
        .on_menu_event(|app, event| {
            if let Some(action) = app_menu::menu_action_for_id(event.id().as_ref()) {
                let _ = app.emit("aspen://menu-action", action);
            }
        })
}

#[cfg(not(target_os = "macos"))]
fn attach_native_menu(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
}
