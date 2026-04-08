use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, State, Url};
use tauri_plugin_updater::{Update, UpdaterExt};

const UPDATE_MANIFEST_URL: &str =
    "https://github.com/0xtaruhi/aspen/releases/latest/download/latest.json";
pub const UPDATE_PUBLIC_KEY: &str = include_str!("../updater/public-key.txt");
pub const UPDATE_PROGRESS_EVENT: &str = "aspen://app-update-progress";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCapability {
    pub current_version: String,
    pub enabled: bool,
}

#[derive(Default)]
pub struct PendingUpdateState {
    pending: Mutex<Option<Update>>,
}

impl PendingUpdateState {
    fn replace(&self, update: Option<Update>) -> Result<(), String> {
        let mut guard = self
            .pending
            .lock()
            .map_err(|_| "failed to acquire updater mutex".to_string())?;
        *guard = update;
        Ok(())
    }

    fn take(&self) -> Result<Update, String> {
        let mut guard = self
            .pending
            .lock()
            .map_err(|_| "failed to acquire updater mutex".to_string())?;
        guard
            .take()
            .ok_or_else(|| "No pending update is ready to install".to_string())
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateCheckResult {
    pub current_version: String,
    pub available: bool,
    pub version: Option<String>,
    pub body: Option<String>,
    pub date: Option<String>,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
enum AppUpdateProgressPhase {
    Downloading,
    Installing,
    Restarting,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateProgressPayload {
    phase: AppUpdateProgressPhase,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
}

fn update_manifest_url() -> Result<Url, String> {
    UPDATE_MANIFEST_URL
        .parse::<Url>()
        .map_err(|err| format!("Invalid updater endpoint: {err}"))
}

fn emit_update_progress(app: &AppHandle, payload: AppUpdateProgressPayload) {
    let _ = app.emit(UPDATE_PROGRESS_EVENT, payload);
}

fn updater_enabled() -> bool {
    option_env!("ASPEN_ENABLE_UPDATER")
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

fn ensure_updater_enabled() -> Result<(), String> {
    if updater_enabled() {
        return Ok(());
    }

    Err("Updater is only enabled in official tagged Aspen releases".to_string())
}

#[tauri::command]
pub fn app_get_update_capability(app: AppHandle) -> AppUpdateCapability {
    AppUpdateCapability {
        current_version: app.package_info().version.to_string(),
        enabled: updater_enabled(),
    }
}

#[tauri::command]
pub async fn app_check_for_updates(
    app: AppHandle,
    pending_update: State<'_, Arc<PendingUpdateState>>,
) -> Result<AppUpdateCheckResult, String> {
    ensure_updater_enabled()?;
    let current_version = app.package_info().version.to_string();
    let updater = app
        .updater_builder()
        .pubkey(UPDATE_PUBLIC_KEY.trim())
        .endpoints(vec![update_manifest_url()?])
        .map_err(|err| err.to_string())?
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|err| err.to_string())?;

    let update = updater.check().await.map_err(|err| err.to_string())?;
    if let Some(update) = update {
        let result = AppUpdateCheckResult {
            current_version: update.current_version.clone(),
            available: true,
            version: Some(update.version.clone()),
            body: update.body.clone(),
            date: update
                .raw_json
                .get("pub_date")
                .and_then(|value| value.as_str())
                .map(ToOwned::to_owned),
        };
        pending_update.replace(Some(update))?;
        return Ok(result);
    }

    pending_update.replace(None)?;

    Ok(AppUpdateCheckResult {
        current_version,
        available: false,
        version: None,
        body: None,
        date: None,
    })
}

#[tauri::command]
pub async fn app_install_update(
    app: AppHandle,
    pending_update: State<'_, Arc<PendingUpdateState>>,
) -> Result<(), String> {
    ensure_updater_enabled()?;
    let update = pending_update.take()?;
    let downloaded_bytes = Arc::new(AtomicU64::new(0));
    let progress_app = app.clone();
    let progress_bytes = downloaded_bytes.clone();
    let install_app = app.clone();

    update
        .download_and_install(
            move |chunk_length, content_length| {
                let downloaded = progress_bytes.fetch_add(chunk_length as u64, Ordering::Relaxed)
                    + chunk_length as u64;
                emit_update_progress(
                    &progress_app,
                    AppUpdateProgressPayload {
                        phase: AppUpdateProgressPhase::Downloading,
                        downloaded_bytes: Some(downloaded),
                        total_bytes: content_length,
                    },
                );
            },
            move || {
                emit_update_progress(
                    &install_app,
                    AppUpdateProgressPayload {
                        phase: AppUpdateProgressPhase::Installing,
                        downloaded_bytes: None,
                        total_bytes: None,
                    },
                );
            },
        )
        .await
        .map_err(|err| err.to_string())?;

    emit_update_progress(
        &app,
        AppUpdateProgressPayload {
            phase: AppUpdateProgressPhase::Restarting,
            downloaded_bytes: None,
            total_bytes: None,
        },
    );

    app.restart();
}

#[cfg(test)]
mod tests {
    use super::updater_enabled;

    #[test]
    fn updater_is_disabled_without_release_flag() {
        assert!(!updater_enabled());
    }
}
