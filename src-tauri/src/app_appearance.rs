#[cfg(target_os = "macos")]
use objc2::MainThreadMarker;
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSAppearance, NSAppearanceCustomization, NSApplication, NSColor, NSView, NSWindow,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSString, NSUserDefaults};
#[cfg(target_os = "windows")]
use tauri::window::Color;
use tauri::{Manager, Theme};
#[cfg(target_os = "macos")]
use tauri_plugin_liquid_glass::{GlassMaterialVariant, LiquidGlassConfig, LiquidGlassExt};
#[cfg(target_os = "windows")]
use window_vibrancy::{apply_acrylic, apply_mica};

#[derive(Clone, Copy, Eq, PartialEq)]
enum ThemeMode {
    System,
    Light,
    Dark,
}

impl ThemeMode {
    fn parse(value: &str) -> Result<Self, String> {
        match value {
            "system" => Ok(Self::System),
            "light" => Ok(Self::Light),
            "dark" => Ok(Self::Dark),
            other => Err(format!("unsupported theme mode '{other}'")),
        }
    }

    #[cfg(not(target_os = "macos"))]
    fn tauri_theme(self) -> Option<Theme> {
        match self {
            Self::System => None,
            Self::Light => Some(Theme::Light),
            Self::Dark => Some(Theme::Dark),
        }
    }
}

fn theme_name(is_dark: bool) -> String {
    if is_dark { "dark" } else { "light" }.to_string()
}

fn resolved_dark_for_window<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<bool, String> {
    Ok(matches!(
        window.theme().map_err(|err| err.to_string())?,
        Theme::Dark
    ))
}

#[cfg(target_os = "macos")]
fn system_dark_mode() -> Result<bool, String> {
    Ok(NSUserDefaults::standardUserDefaults()
        .stringForKey(&NSString::from_str("AppleInterfaceStyle"))
        .map(|value| value.to_string())
        .as_deref()
        == Some("Dark"))
}

#[cfg(target_os = "windows")]
fn system_dark_mode() -> Result<bool, String> {
    use std::{ffi::OsStr, iter, mem::size_of, os::windows::ffi::OsStrExt, ptr::null_mut};

    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    fn wide(value: &str) -> Vec<u16> {
        OsStr::new(value)
            .encode_wide()
            .chain(iter::once(0))
            .collect()
    }

    let subkey = wide("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize");
    let value = wide("AppsUseLightTheme");
    let mut data = 1u32;
    let mut len = size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            subkey.as_ptr(),
            value.as_ptr(),
            RRF_RT_REG_DWORD,
            null_mut(),
            (&mut data as *mut u32).cast(),
            &mut len,
        )
    };

    if status == 0 {
        Ok(data == 0)
    } else {
        Err(format!(
            "failed to query AppsUseLightTheme registry value: error {status}"
        ))
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn system_dark_mode() -> Result<bool, String> {
    Err("native system theme query is unavailable on this platform".to_string())
}

#[tauri::command]
pub fn app_get_system_theme() -> Result<String, String> {
    system_dark_mode().map(theme_name)
}

#[tauri::command]
pub fn app_set_window_appearance(
    app: tauri::AppHandle,
    mode: String,
    resolved_dark: bool,
) -> Result<bool, String> {
    let mode = ThemeMode::parse(&mode)?;
    let Some(window) = app.get_webview_window("main") else {
        return Ok(resolved_dark);
    };

    apply_window_theme(&app, &window, mode, resolved_dark)
}

pub fn configure_window_material<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if let Err(err) = apply_window_material(app, &window) {
        eprintln!("failed to configure native window materials: {err}");
    }
}

#[cfg(target_os = "macos")]
fn liquid_glass_config(is_dark: bool) -> LiquidGlassConfig {
    LiquidGlassConfig {
        corner_radius: 0.0,
        tint_color: is_dark.then(|| "#02030588".to_string()),
        variant: GlassMaterialVariant::Sidebar,
        ..Default::default()
    }
}

#[cfg(target_os = "macos")]
fn appearance_name(name: &str) -> objc2::rc::Retained<NSString> {
    NSString::from_str(name)
}

#[cfg(target_os = "macos")]
fn requested_macos_appearance(mode: ThemeMode) -> Option<objc2::rc::Retained<NSAppearance>> {
    match mode {
        ThemeMode::Light => NSAppearance::appearanceNamed(&appearance_name("NSAppearanceNameAqua")),
        ThemeMode::Dark => {
            NSAppearance::appearanceNamed(&appearance_name("NSAppearanceNameDarkAqua"))
        }
        ThemeMode::System => None,
    }
}

#[cfg(target_os = "macos")]
fn resolved_dark_from_effective_appearance(appearance: &NSAppearance) -> bool {
    let appearances = [
        appearance_name("NSAppearanceNameAqua"),
        appearance_name("NSAppearanceNameDarkAqua"),
    ];
    let names = NSArray::from_retained_slice(&appearances);
    matches!(
        appearance
            .bestMatchFromAppearancesWithNames(&names)
            .map(|value| value.to_string()),
        Some(name) if name == "NSAppearanceNameDarkAqua"
    )
}

#[cfg(target_os = "macos")]
fn apply_macos_window_appearance<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    mode: ThemeMode,
) -> Result<bool, String> {
    let result = std::sync::Arc::new(std::sync::Mutex::new(None::<Result<bool, String>>));
    let result_for_closure = std::sync::Arc::clone(&result);

    window
        .with_webview(move |webview| unsafe {
            let outcome = (|| -> Result<bool, String> {
                let appearance = requested_macos_appearance(mode);
                let mtm = MainThreadMarker::new()
                    .ok_or_else(|| "failed to acquire macOS main thread marker".to_string())?;
                let app = NSApplication::sharedApplication(mtm);

                app.setAppearance(appearance.as_deref());

                let ns_window: &NSWindow = &*webview.ns_window().cast();
                ns_window.setAppearance(appearance.as_deref());

                if let Some(content_view) = ns_window.contentView() {
                    content_view.setAppearance(appearance.as_deref());
                }

                let webview_view: &NSView = &*webview.inner().cast();
                webview_view.setAppearance(appearance.as_deref());

                Ok(resolved_dark_from_effective_appearance(
                    &webview_view.effectiveAppearance(),
                ))
            })();

            if let Ok(mut slot) = result_for_closure.lock() {
                *slot = Some(outcome);
            }
        })
        .map_err(|err| err.to_string())?;

    let outcome = result
        .lock()
        .map_err(|_| "failed to acquire macOS appearance result mutex".to_string())?
        .take()
        .ok_or_else(|| "macOS appearance update produced no result".to_string())?;

    outcome
}

#[cfg(target_os = "macos")]
fn apply_window_theme<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
    mode: ThemeMode,
    _resolved_dark: bool,
) -> Result<bool, String> {
    let actual_dark = apply_macos_window_appearance(window, mode)?;
    app.liquid_glass()
        .set_effect(window, liquid_glass_config(actual_dark))
        .map_err(|err| err.to_string())?;
    Ok(actual_dark)
}

#[cfg(not(target_os = "macos"))]
fn apply_window_theme<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
    mode: ThemeMode,
    resolved_dark: bool,
) -> Result<bool, String> {
    window
        .set_theme(mode.tauri_theme())
        .map_err(|err| err.to_string())?;

    match mode {
        ThemeMode::System => resolved_dark_for_window(window).or(Ok(resolved_dark)),
        ThemeMode::Light => Ok(false),
        ThemeMode::Dark => Ok(true),
    }
}

#[cfg(target_os = "macos")]
fn apply_window_material<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    let is_dark = resolved_dark_for_window(window).or_else(|_| system_dark_mode())?;

    app.liquid_glass()
        .set_effect(window, liquid_glass_config(is_dark))
        .map_err(|err| err.to_string())?;

    window
        .with_webview(|webview| unsafe {
            let ns_window: &NSWindow = &*webview.ns_window().cast();
            let background = NSColor::windowBackgroundColor();
            ns_window.setBackgroundColor(Some(&background));
        })
        .map_err(|err| err.to_string())
}

#[cfg(target_os = "windows")]
fn apply_window_material<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    window
        .set_background_color(Some(Color(0, 0, 0, 0)))
        .map_err(|err| err.to_string())?;

    if windows_supports_mica() {
        apply_mica(window, None)
    } else {
        apply_acrylic(window, None)
    }
    .map_err(|err| err.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply_window_material<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    _window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn windows_supports_mica() -> bool {
    use std::mem::size_of;

    use windows_sys::{
        Wdk::System::SystemServices::RtlGetVersion,
        Win32::System::SystemInformation::OSVERSIONINFOW,
    };

    let mut version = OSVERSIONINFOW::default();
    version.dwOSVersionInfoSize = size_of::<OSVERSIONINFOW>() as u32;
    let status = unsafe { RtlGetVersion(&mut version) };
    status >= 0 && version.dwMajorVersion >= 10 && version.dwBuildNumber >= 22_000
}
