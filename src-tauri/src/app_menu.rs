#[cfg(target_os = "macos")]
use objc2_foundation::NSLocale;
#[cfg(not(target_os = "macos"))]
use std::env;
use tauri::{
    menu::{
        AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu, HELP_SUBMENU_ID,
        WINDOW_SUBMENU_ID,
    },
    AppHandle, Runtime,
};

pub const MENU_ACTION_NEW_PROJECT: &str = "menu.new-project";
pub const MENU_ACTION_OPEN_PROJECT: &str = "menu.open-project";
pub const MENU_ACTION_CLOSE_PROJECT: &str = "menu.close-project";
pub const MENU_ACTION_SAVE_PROJECT: &str = "menu.save-project";
pub const MENU_ACTION_SAVE_PROJECT_AS: &str = "menu.save-project-as";
pub const MENU_ACTION_OPEN_SETTINGS: &str = "menu.open-settings";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MenuLanguage {
    English,
    SimplifiedChinese,
    TraditionalChinese,
}

struct MenuStrings {
    file: &'static str,
    edit: &'static str,
    view: &'static str,
    window: &'static str,
    help: &'static str,
    services: &'static str,
    hide_others: &'static str,
    show_all: &'static str,
    undo: &'static str,
    redo: &'static str,
    cut: &'static str,
    copy: &'static str,
    paste: &'static str,
    select_all: &'static str,
    minimize: &'static str,
    zoom: &'static str,
    close_window: &'static str,
    fullscreen: &'static str,
    new_project: &'static str,
    open_project: &'static str,
    close_project: &'static str,
    save_project: &'static str,
    save_project_as: &'static str,
    settings: &'static str,
    about_prefix: &'static str,
    hide_prefix: &'static str,
    quit_prefix: &'static str,
}

impl MenuStrings {
    fn for_language(language: MenuLanguage) -> Self {
        match language {
            MenuLanguage::English => Self {
                file: "File",
                edit: "Edit",
                view: "View",
                window: "Window",
                help: "Help",
                services: "Services",
                hide_others: "Hide Others",
                show_all: "Show All",
                undo: "Undo",
                redo: "Redo",
                cut: "Cut",
                copy: "Copy",
                paste: "Paste",
                select_all: "Select All",
                minimize: "Minimize",
                zoom: "Zoom",
                close_window: "Close Window",
                fullscreen: "Toggle Full Screen",
                new_project: "New Project...",
                open_project: "Open Project...",
                close_project: "Close Project",
                save_project: "Save Project",
                save_project_as: "Save Project As...",
                settings: "Settings...",
                about_prefix: "About",
                hide_prefix: "Hide",
                quit_prefix: "Quit",
            },
            MenuLanguage::SimplifiedChinese => Self {
                file: "文件",
                edit: "编辑",
                view: "视图",
                window: "窗口",
                help: "帮助",
                services: "服务",
                hide_others: "隐藏其他项目",
                show_all: "全部显示",
                undo: "撤销",
                redo: "重做",
                cut: "剪切",
                copy: "复制",
                paste: "粘贴",
                select_all: "全选",
                minimize: "最小化",
                zoom: "缩放",
                close_window: "关闭窗口",
                fullscreen: "切换全屏",
                new_project: "新建项目...",
                open_project: "打开项目...",
                close_project: "关闭项目",
                save_project: "保存项目",
                save_project_as: "项目另存为...",
                settings: "设置...",
                about_prefix: "关于",
                hide_prefix: "隐藏",
                quit_prefix: "退出",
            },
            MenuLanguage::TraditionalChinese => Self {
                file: "檔案",
                edit: "編輯",
                view: "檢視",
                window: "視窗",
                help: "說明",
                services: "服務",
                hide_others: "隱藏其他視窗",
                show_all: "顯示全部",
                undo: "復原",
                redo: "重做",
                cut: "剪下",
                copy: "複製",
                paste: "貼上",
                select_all: "全選",
                minimize: "最小化",
                zoom: "縮放",
                close_window: "關閉視窗",
                fullscreen: "切換全螢幕",
                new_project: "新增專案...",
                open_project: "開啟專案...",
                close_project: "關閉專案",
                save_project: "儲存專案",
                save_project_as: "專案另存新檔...",
                settings: "設定...",
                about_prefix: "關於",
                hide_prefix: "隱藏",
                quit_prefix: "結束",
            },
        }
    }

    fn about_label(&self, app_name: &str) -> String {
        format!("{} {}", self.about_prefix, app_name)
    }

    fn hide_label(&self, app_name: &str) -> String {
        format!("{} {}", self.hide_prefix, app_name)
    }

    fn quit_label(&self, app_name: &str) -> String {
        format!("{} {}", self.quit_prefix, app_name)
    }
}

fn menu_language_for_locale_identifier(locale_identifier: &str) -> MenuLanguage {
    let normalized = locale_identifier
        .trim()
        .to_ascii_lowercase()
        .replace('_', "-");

    if normalized.starts_with("zh-hant")
        || normalized.contains("-hant")
        || normalized.contains("-tw")
        || normalized.contains("-hk")
        || normalized.contains("-mo")
    {
        return MenuLanguage::TraditionalChinese;
    }

    if normalized.starts_with("zh") {
        return MenuLanguage::SimplifiedChinese;
    }

    MenuLanguage::English
}

#[cfg(target_os = "macos")]
fn preferred_locale_identifier() -> Option<String> {
    let preferred_languages = NSLocale::preferredLanguages();
    preferred_languages
        .firstObject()
        .map(|language| language.to_string())
        .filter(|language| !language.is_empty())
        .or_else(|| {
            let current_locale = NSLocale::currentLocale();
            let identifier = current_locale.localeIdentifier().to_string();
            (!identifier.is_empty()).then_some(identifier)
        })
}

#[cfg(not(target_os = "macos"))]
fn preferred_locale_identifier() -> Option<String> {
    ["LANGUAGE", "LC_ALL", "LC_MESSAGES", "LANG"]
        .into_iter()
        .find_map(|key| {
            let value = env::var(key).ok()?;
            value
                .split(':')
                .map(str::trim)
                .find(|value| !value.is_empty() && *value != "C" && *value != "POSIX")
                .map(str::to_string)
        })
}

fn detect_menu_language() -> MenuLanguage {
    preferred_locale_identifier()
        .as_deref()
        .map(menu_language_for_locale_identifier)
        .unwrap_or(MenuLanguage::English)
}

pub fn menu_action_for_id(menu_id: &str) -> Option<&'static str> {
    match menu_id {
        MENU_ACTION_NEW_PROJECT => Some("new-project"),
        MENU_ACTION_OPEN_PROJECT => Some("open-project"),
        MENU_ACTION_CLOSE_PROJECT => Some("close-project"),
        MENU_ACTION_SAVE_PROJECT => Some("save-project"),
        MENU_ACTION_SAVE_PROJECT_AS => Some("save-project-as"),
        MENU_ACTION_OPEN_SETTINGS => Some("open-settings"),
        _ => None,
    }
}

pub fn build_app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let package_info = app.package_info();
    let config = app.config();
    let app_name = package_info.name.clone();
    let strings = MenuStrings::for_language(detect_menu_language());
    let about_label = strings.about_label(&app_name);
    let hide_label = strings.hide_label(&app_name);
    let quit_label = strings.quit_label(&app_name);

    let about_metadata = AboutMetadata {
        name: Some(package_info.name.clone()),
        version: Some(package_info.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };

    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                app_name.clone(),
                true,
                &[
                    &PredefinedMenuItem::about(
                        app,
                        Some(about_label.as_str()),
                        Some(about_metadata.clone()),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        MENU_ACTION_OPEN_SETTINGS,
                        strings.settings,
                        true,
                        Some("CmdOrCtrl+,"),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::services(app, Some(strings.services))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, Some(hide_label.as_str()))?,
                    &PredefinedMenuItem::hide_others(app, Some(strings.hide_others))?,
                    &PredefinedMenuItem::show_all(app, Some(strings.show_all))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, Some(quit_label.as_str()))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                strings.file,
                true,
                &[
                    &MenuItem::with_id(
                        app,
                        MENU_ACTION_NEW_PROJECT,
                        strings.new_project,
                        true,
                        Some("CmdOrCtrl+N"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        MENU_ACTION_OPEN_PROJECT,
                        strings.open_project,
                        true,
                        Some("CmdOrCtrl+O"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        MENU_ACTION_CLOSE_PROJECT,
                        strings.close_project,
                        true,
                        Some("CmdOrCtrl+Shift+W"),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &MenuItem::with_id(
                        app,
                        MENU_ACTION_SAVE_PROJECT,
                        strings.save_project,
                        true,
                        Some("CmdOrCtrl+S"),
                    )?,
                    &MenuItem::with_id(
                        app,
                        MENU_ACTION_SAVE_PROJECT_AS,
                        strings.save_project_as,
                        true,
                        Some("CmdOrCtrl+Shift+S"),
                    )?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, Some(strings.close_window))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                strings.edit,
                true,
                &[
                    &PredefinedMenuItem::undo(app, Some(strings.undo))?,
                    &PredefinedMenuItem::redo(app, Some(strings.redo))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::cut(app, Some(strings.cut))?,
                    &PredefinedMenuItem::copy(app, Some(strings.copy))?,
                    &PredefinedMenuItem::paste(app, Some(strings.paste))?,
                    &PredefinedMenuItem::select_all(app, Some(strings.select_all))?,
                ],
            )?,
            &Submenu::with_items(
                app,
                strings.view,
                true,
                &[&PredefinedMenuItem::fullscreen(
                    app,
                    Some(strings.fullscreen),
                )?],
            )?,
            &Submenu::with_id_and_items(
                app,
                WINDOW_SUBMENU_ID,
                strings.window,
                true,
                &[
                    &PredefinedMenuItem::minimize(app, Some(strings.minimize))?,
                    &PredefinedMenuItem::maximize(app, Some(strings.zoom))?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::close_window(app, Some(strings.close_window))?,
                ],
            )?,
            &Submenu::with_id_and_items(app, HELP_SUBMENU_ID, strings.help, true, &[])?,
        ],
    )
}

#[cfg(test)]
mod tests {
    use super::{menu_action_for_id, menu_language_for_locale_identifier, MenuLanguage};

    #[test]
    fn detects_simplified_chinese_locales() {
        assert_eq!(
            menu_language_for_locale_identifier("zh-Hans-CN"),
            MenuLanguage::SimplifiedChinese
        );
        assert_eq!(
            menu_language_for_locale_identifier("zh_CN"),
            MenuLanguage::SimplifiedChinese
        );
    }

    #[test]
    fn detects_traditional_chinese_locales() {
        assert_eq!(
            menu_language_for_locale_identifier("zh-Hant-TW"),
            MenuLanguage::TraditionalChinese
        );
        assert_eq!(
            menu_language_for_locale_identifier("zh-HK"),
            MenuLanguage::TraditionalChinese
        );
    }

    #[test]
    fn falls_back_to_english_for_other_locales() {
        assert_eq!(
            menu_language_for_locale_identifier("en-US"),
            MenuLanguage::English
        );
        assert_eq!(
            menu_language_for_locale_identifier("ja-JP"),
            MenuLanguage::English
        );
    }

    #[test]
    fn maps_custom_menu_ids_to_frontend_actions() {
        assert_eq!(
            menu_action_for_id(super::MENU_ACTION_NEW_PROJECT),
            Some("new-project")
        );
        assert_eq!(
            menu_action_for_id(super::MENU_ACTION_OPEN_PROJECT),
            Some("open-project")
        );
        assert_eq!(
            menu_action_for_id(super::MENU_ACTION_CLOSE_PROJECT),
            Some("close-project")
        );
        assert_eq!(menu_action_for_id("menu.unknown"), None);
    }
}
