#[cfg(target_os = "macos")]
use objc2::{MainThreadMarker, Message};
#[cfg(target_os = "macos")]
use objc2_app_kit::{
    NSAppearance, NSAppearanceCustomization, NSApplication, NSColor, NSScrollElasticity,
    NSScrollView, NSView, NSWindow,
};
#[cfg(target_os = "macos")]
use objc2_foundation::{NSArray, NSString, NSUserDefaults};
#[cfg(target_os = "windows")]
use tauri::window::Color;
#[cfg(target_os = "macos")]
use tauri::window::{Effect, EffectState, EffectsBuilder};
use tauri::Manager;
#[cfg(not(target_os = "macos"))]
use tauri::Theme;

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

#[cfg(not(target_os = "macos"))]
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
fn macos_window_effects() -> tauri::utils::config::WindowEffectsConfig {
    EffectsBuilder::new()
        .effect(Effect::Sidebar)
        .state(EffectState::Active)
        .build()
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
    _app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
    mode: ThemeMode,
    _resolved_dark: bool,
) -> Result<bool, String> {
    let actual_dark = apply_macos_window_appearance(window, mode)?;
    apply_macos_window_material(window)?;
    Ok(actual_dark)
}

#[cfg(target_os = "macos")]
fn apply_macos_window_material<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    window
        .set_effects(macos_window_effects())
        .map_err(|err| format!("failed to set window effects: {err}"))?;

    window
        .with_webview(|webview| unsafe {
            let ns_window: &NSWindow = &*webview.ns_window().cast();
            ns_window.setOpaque(false);
            let background = NSColor::clearColor();
            ns_window.setBackgroundColor(Some(&background));

            let webview_view: &NSView = &*webview.inner().cast();
            configure_macos_webview_scroll_behavior(webview_view);
        })
        .map_err(|err| format!("failed to apply NSWindow styling: {err}"))
}

#[cfg(target_os = "macos")]
fn configure_macos_webview_scroll_behavior(root_view: &NSView) {
    if let Some(scroll_view) = find_descendant_scroll_view(root_view) {
        scroll_view.setHorizontalScrollElasticity(NSScrollElasticity::None);
        scroll_view.setVerticalScrollElasticity(NSScrollElasticity::None);
    }
}

#[cfg(target_os = "macos")]
fn find_descendant_scroll_view(view: &NSView) -> Option<objc2::rc::Retained<NSScrollView>> {
    if let Some(scroll_view) = view.enclosingScrollView() {
        return Some(scroll_view);
    }

    for subview in view.subviews().iter() {
        if let Some(scroll_view) = subview.downcast_ref::<NSScrollView>() {
            return Some(scroll_view.retain());
        }

        if let Some(scroll_view) = find_descendant_scroll_view(&subview) {
            return Some(scroll_view);
        }
    }

    None
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
    _app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    apply_macos_window_material(window)
}

#[cfg(target_os = "windows")]
fn apply_window_material<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    window
        .set_background_color(Some(Color(0, 0, 0, 0)))
        .map_err(|err| err.to_string())
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn apply_window_material<R: tauri::Runtime>(
    _app: &tauri::AppHandle<R>,
    _window: &tauri::WebviewWindow<R>,
) -> Result<(), String> {
    Ok(())
}
