use std::path::Path;
use std::time::Duration;

use tauri::webview::{PermissionKind, PermissionResponse, WebviewBuilder};
use tauri::window::Color;
use tauri::{App, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, Window, WindowEvent};

use crate::core::error::{AppError, AppResult};
use crate::core::state::AppState;
use crate::settings::model::WindowSettings;
use crate::theme::model::{ResolvedTheme, ThemeSettings};
use crate::theme::service::ThemeService;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const PIP_WINDOW_LABEL: &str = "pip";
pub const AUTH_MODAL_WINDOW_LABEL: &str = "auth_modal";
pub const AUTH_UI_WEBVIEW_LABEL: &str = "auth_ui";
pub const AUTH_WEB_WEBVIEW_LABEL: &str = "auth_web";
pub const UI_WEBVIEW_LABEL: &str = "ui";
pub const TAB_DOCK_WEBVIEW_LABEL: &str = "tab_dock";
pub const YOUTUBE_WEBVIEW_LABEL: &str = "yt";

/// Custom title bar height, in logical pixels. Must match `--titlebar-height`
/// in CSS.
pub const TITLEBAR_HEIGHT: f64 = 40.0;

pub use super::auth_modal::{
    build_auth_web_webview, ensure_auth_modal_window, sync_auth_modal_position,
};

pub(crate) const INITIAL_WIDTH: f64 = 1280.0;
pub(crate) const INITIAL_HEIGHT: f64 = 800.0;
const YOUTUBE_URL: &str = "https://www.youtube.com";

/// Creates the main window and the two webviews:
/// - `ui`: the launcher interface, covering the entire window (title bar and
///   content).
/// - `yt`: YouTube, in the content area below the title bar, with WebView2
///   browser extensions enabled.
///
/// Each webview owns a separate WebView2 user data folder. WebView2 refuses to
/// share a folder between environments created with different options, and the
/// YouTube webview enables browser extensions while the launcher does not.
pub fn setup(
    app: &mut App,
    webview_data_dir: &Path,
    window_settings: &WindowSettings,
) -> AppResult<Window> {
    let width = window_settings.width.max(520.0);
    let height = window_settings.height.max(420.0);

    let window = tauri::window::WindowBuilder::new(app, MAIN_WINDOW_LABEL)
        .title("YouTube Client")
        .inner_size(width, height)
        .min_inner_size(520.0, 420.0)
        .decorations(false)
        .transparent(true)
        .visible(false)
        .maximized(window_settings.maximized)
        .build()?;

    let ui = WebviewBuilder::new(UI_WEBVIEW_LABEL, WebviewUrl::App("index.html".into()))
        .data_directory(webview_data_dir.join("ui"))
        .background_color(Color(0, 0, 0, 0));
    let ui = window.add_child(
        ui,
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(INITIAL_WIDTH, INITIAL_HEIGHT),
    )?;
    #[cfg(windows)]
    super::webview_popups::watch(&window, &ui);

    let theme = current_theme(&window);
    if let Some(active_tab) = window
        .app_handle()
        .try_state::<AppState>()
        .and_then(|state| state.tabs.lock().ok().and_then(|m| m.active_tab().cloned()))
    {
        create_tab_webview(&window, &active_tab, theme.as_ref())?;
    } else {
        add_youtube(&window, webview_data_dir, theme.as_ref())?;
    }

    let _ = sync_tab_dock_webview(&window, webview_data_dir);
    layout_webviews(&window)?;
    observe_window(&window);
    crate::window::tray::setup(app)?;

    Ok(window)
}

pub fn active_youtube_label(app: &tauri::AppHandle) -> String {
    app.try_state::<AppState>()
        .and_then(|state| {
            state
                .tabs
                .lock()
                .ok()
                .and_then(|manager| manager.active_tab().map(|tab| tab.webview_label.clone()))
        })
        .unwrap_or_else(|| "yt-tab-1".to_string())
}

pub fn active_youtube_webview(window: &Window) -> Option<tauri::Webview> {
    let label = active_youtube_label(window.app_handle());
    window
        .get_webview(&label)
        .or_else(|| window.get_webview(YOUTUBE_WEBVIEW_LABEL))
}

pub fn chrome_insets(window: &Window) -> (f64, f64, f64) {
    use crate::settings::model::TabLayout;

    let Some(state) = window.app_handle().try_state::<AppState>() else {
        return (0.0, TITLEBAR_HEIGHT, 0.0);
    };
    let Ok(settings) = state.settings.read() else {
        return (0.0, TITLEBAR_HEIGHT, 0.0);
    };
    let tabs = settings.snapshot().tabs;
    if !tabs.enabled {
        return (0.0, TITLEBAR_HEIGHT, 0.0);
    }
    let narrow_window = window
        .inner_size()
        .ok()
        .zip(window.scale_factor().ok())
        .map(|(size, scale)| (size.width as f64 / scale.max(0.0001)) < 720.0)
        .unwrap_or(false);
    let left = match tabs.layout {
        TabLayout::Sidebar => {
            let expanded = state
                .sidebar_expanded
                .load(std::sync::atomic::Ordering::SeqCst);
            if expanded && !narrow_window {
                state
                    .sidebar_width
                    .load(std::sync::atomic::Ordering::SeqCst)
                    .clamp(148, 220) as f64
            } else {
                56.0
            }
        }
        TabLayout::Command | TabLayout::Bottom | TabLayout::Floating | TabLayout::SidebarHover => 0.0,
    };
    let bottom = match tabs.layout {
        TabLayout::Bottom => 34.0,
        TabLayout::Command | TabLayout::Floating | TabLayout::Sidebar | TabLayout::SidebarHover => 0.0,
    };
    (left, TITLEBAR_HEIGHT, bottom)
}

pub fn tab_dock_bounds(window: &Window) -> AppResult<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let scale = window.scale_factor()?.max(0.0001);
    let size = window.inner_size()?;
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    let raw_w = window
        .app_handle()
        .try_state::<AppState>()
        .map(|s| s.dock_width.load(std::sync::atomic::Ordering::SeqCst) as f64)
        .unwrap_or(240.0);
    let dock_w = raw_w.clamp(120.0, (width - 24.0).max(120.0));
    let dock_h = 56.0;
    let x = ((width - dock_w) / 2.0).max(12.0);
    let y = (height - dock_h).max(TITLEBAR_HEIGHT + 8.0);
    Ok((LogicalPosition::new(x, y), LogicalSize::new(dock_w, dock_h)))
}

pub fn sync_tab_dock_webview(window: &Window, webview_data_dir: &Path) -> AppResult<()> {
    use crate::settings::model::TabLayout;

    let (is_floating, dock_peek) = window
        .app_handle()
        .try_state::<AppState>()
        .map(|s| {
            let floating = s
                .settings
                .read()
                .ok()
                .map(|st| {
                    let tabs = st.snapshot().tabs;
                    tabs.enabled && tabs.layout == TabLayout::Floating
                })
                .unwrap_or(false);
            let peek = s.dock_peek.load(std::sync::atomic::Ordering::SeqCst);
            (floating, peek)
        })
        .unwrap_or((false, false));

    if is_floating {
        let (pos, size) = tab_dock_bounds(window)?;
        if let Some(dock) = window.get_webview(TAB_DOCK_WEBVIEW_LABEL) {
            let _ = dock.set_position(pos);
            let _ = dock.set_size(size);
            if dock_peek {
                let _ = dock.show();
            } else {
                let _ = dock.hide();
            }
        } else {
            let builder = WebviewBuilder::new(
                TAB_DOCK_WEBVIEW_LABEL,
                WebviewUrl::App("index.html?dock=1".into()),
            )
            .data_directory(webview_data_dir.join("ui"))
            .background_color(Color(0, 0, 0, 0));
            let dock = window.add_child(builder, pos, size)?;
            if !dock_peek {
                let _ = dock.hide();
            }
            #[cfg(windows)]
            super::webview_popups::watch(window, &dock);
        }
    } else {
        if let Some(state) = window.app_handle().try_state::<AppState>() {
            state
                .dock_peek
                .store(false, std::sync::atomic::Ordering::SeqCst);
        }
        if let Some(dock) = window.get_webview(TAB_DOCK_WEBVIEW_LABEL) {
            let _ = dock.hide();
            #[cfg(windows)]
            super::webview_popups::unwatch_webview(&dock);
            let _ = dock.close();
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
pub fn set_webview_muted(window: &Window, label: &str, muted: bool) -> AppResult<()> {
    if let Some(webview) = window.get_webview(label) {
        let _ = webview.with_webview(move |platform| unsafe {
            use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_8;
            use windows_core::Interface;
            if let Ok(core) = platform.controller().CoreWebView2() {
                if let Ok(core8) = core.cast::<ICoreWebView2_8>() {
                    let _ = core8.SetIsMuted(muted);
                }
            }
        });
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn set_webview_muted(_window: &Window, _label: &str, _muted: bool) -> AppResult<()> {
    Ok(())
}

/// Rebuilds the active YouTube tab webview and marks background tabs for lazy reload.
pub async fn reload_youtube(
    window: &Window,
    _webview_data_dir: &Path,
    visible: bool,
) -> AppResult<()> {
    let active_tab = window
        .app_handle()
        .try_state::<AppState>()
        .and_then(|state| {
            state.tabs.lock().ok().and_then(|mut manager| {
                manager.mark_inactive_needs_reload();
                manager.active_tab().cloned()
            })
        })
        .ok_or_else(|| AppError::State("active tab unavailable".into()))?;

    if let Some(state) = window.app_handle().try_state::<AppState>() {
        if let Ok(mut painted) = state.painted_webviews.lock() {
            painted.clear();
        }
    }
    if let Some(existing) = window.get_webview(&active_tab.webview_label) {
        let _ = existing.close();
    }

    let theme = current_theme(window);
    let mut last_error = None;
    for attempt in 0..10 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(300)).await;
        }

        match create_tab_webview(window, &active_tab, theme.as_ref()) {
            Ok(()) => {
                if !visible {
                    if let Some(webview) = window.get_webview(&active_tab.webview_label) {
                        let _ = webview.hide();
                    }
                }
                return Ok(());
            }
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| AppError::Other("could not reload YouTube".into())))
}

/// Resolves the theme that is active right now, so the injected script can
/// style the document before YouTube paints for the first time.
fn current_theme(window: &Window) -> Option<ResolvedTheme> {
    use crate::core::state::AppState;

    let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
    let settings = window
        .app_handle()
        .try_state::<AppState>()
        .and_then(|state| state.settings.read().ok().map(|store| store.snapshot().theme))
        .unwrap_or_default();
    ThemeService::resolve(&settings, system_dark)
        .or_else(|_| ThemeService::resolve(&ThemeSettings::default(), system_dark))
        .ok()
}

pub(crate) fn normalize_youtube_url(value: &str) -> Option<String> {
    let mut url = tauri::Url::parse(value).ok()?;
    let host = url.host_str()?.to_ascii_lowercase();
    if url.scheme() != "https"
        || (!host.ends_with(".youtube.com") && host != "youtube.com")
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return None;
    }

    let path = url.path().to_ascii_lowercase();
    if ["/logout", "/signin", "/sign_in", "/account", "/redirect"]
        .iter()
        .any(|blocked| path == *blocked || path.starts_with(&format!("{blocked}/")))
    {
        return None;
    }

    url.set_fragment(None);
    Some(url.to_string())
}

fn startup_youtube_url(window: &Window) -> tauri::Url {
    let default = YOUTUBE_URL.parse().expect("invalid YouTube URL");
    let Some(state) = window
        .app_handle()
        .try_state::<crate::core::state::AppState>()
    else {
        return default;
    };
    let Ok(settings) = state.settings.read() else {
        return default;
    };
    let settings = settings.snapshot();
    if !settings.general.open_last_page {
        return default;
    }

    settings
        .general
        .last_youtube_url
        .as_deref()
        .and_then(normalize_youtube_url)
        .and_then(|url| tauri::Url::parse(&url).ok())
        .unwrap_or(default)
}

pub fn create_tab_webview(
    window: &Window,
    tab: &crate::tabs::TabState,
    theme: Option<&ResolvedTheme>,
) -> AppResult<()> {
    let profile_dir = window
        .app_handle()
        .try_state::<AppState>()
        .map(|state| state.paths.tab_webview_dir(&tab.id, tab.isolated))
        .ok_or_else(|| AppError::State("app paths unavailable".into()))?;
    let _ = std::fs::create_dir_all(&profile_dir);

    let url = normalize_youtube_url(&tab.url)
        .and_then(|value| tauri::Url::parse(&value).ok())
        .unwrap_or_else(|| YOUTUBE_URL.parse().expect("invalid YouTube URL"));

    create_youtube_webview_with_dir(
        window,
        &tab.webview_label,
        &profile_dir,
        url,
        tab.muted,
        theme,
    )
}

fn add_youtube(
    window: &Window,
    webview_data_dir: &Path,
    theme: Option<&ResolvedTheme>,
) -> AppResult<()> {
    let url = startup_youtube_url(window);
    create_youtube_webview_with_dir(
        window,
        YOUTUBE_WEBVIEW_LABEL,
        &webview_data_dir.join("profiles").join("default"),
        url,
        false,
        theme,
    )
}

fn create_youtube_webview_with_dir(
    window: &Window,
    label: &str,
    data_dir: &Path,
    url: tauri::Url,
    muted: bool,
    theme: Option<&ResolvedTheme>,
) -> AppResult<()> {
    let (position, size) = youtube_bounds(window)?;

    // The resolved theme is embedded in the initialization script: the script
    // runs before the page is parsed, so the transparent/themed stylesheet is
    // already in place on the very first paint. Runtime updates still arrive
    // through `apply_to_youtube`.
    let masthead_integrated = window
        .app_handle()
        .try_state::<crate::core::state::AppState>()
        .map(|state| {
            state
                .settings
                .read()
                .map(|store| store.snapshot().general.integrate_masthead)
                .unwrap_or(false)
        })
        .unwrap_or(false);

    let config_epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos().to_string())
        .unwrap_or_else(|_| "0".to_string());
    let initial = theme
        .and_then(|theme| serde_json::to_string(theme).ok())
        .map(|json| format!("window.__ytdesktopInitialTheme = {json};\n"))
        .unwrap_or_default();
    let initial_masthead =
        format!("window.__ytdesktopInitialMastheadIntegrated = {masthead_integrated};\n");
    let peek_mode = window
        .app_handle()
        .try_state::<AppState>()
        .and_then(|s| s.settings.read().ok().map(|st| st.snapshot().tabs))
        .map(|tabs| {
            if !tabs.enabled {
                "none"
            } else {
                match tabs.layout {
                    crate::settings::model::TabLayout::SidebarHover => "sidebarHover",
                    crate::settings::model::TabLayout::Floating => "floating",
                    _ => "none",
                }
            }
        })
        .unwrap_or("none");
    let initial_peek_mode = format!("window.__ytdesktopPeekMode = \"{peek_mode}\";\n");
    let script = format!(
        "window.__ytdesktopConfigEpoch = \"{config_epoch}\";\n{initial}{initial_masthead}{initial_peek_mode}{}",
        include_str!("../../../injected/theme.js")
    );
    let app_handle = window.app_handle().clone();
    let webview_label = label.to_string();

    #[cfg(windows)]
    let webview_bg = match theme {
        Some(resolved) if resolved.backdrop == crate::theme::model::Backdrop::Solid => {
            crate::theme::service::fallback_background(resolved)
        }
        _ => Color(0, 0, 0, 0),
    };
    #[cfg(not(windows))]
    let webview_bg = Color(0, 0, 0, 0);

    let make = |with_extensions: bool| {
        let mut builder =
            WebviewBuilder::new(&webview_label, WebviewUrl::External(url.clone()))
                .data_directory(data_dir.to_path_buf())
                // Opaque in Solid backdrop so navigation/compositor redraws never
                // expose a transparent hole; transparent in Mica/Acrylic so the
                // native material shows through.
                .background_color(webview_bg)
                .on_permission_request({
                    let app = app_handle.clone();
                    move |webview, kind| {
                        if kind != PermissionKind::Microphone { return PermissionResponse::Default; }
                        let youtube_host = webview.url().ok().and_then(|url| url.host_str().map(str::to_owned))
                            .map(|host| host == "youtube.com" || host.ends_with(".youtube.com"))
                            .unwrap_or(false);
                        if !youtube_host { return PermissionResponse::Default; }
                        let Some(state) = app.try_state::<AppState>() else { return PermissionResponse::Default; };
                        let deadline = state.microphone_permission_until_ms.load(std::sync::atomic::Ordering::SeqCst);
                        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
                            .map(|duration| duration.as_millis() as u64).unwrap_or(u64::MAX);
                        if deadline >= now && deadline != 0
                            && state.microphone_permission_until_ms.compare_exchange(
                                deadline, 0, std::sync::atomic::Ordering::SeqCst, std::sync::atomic::Ordering::SeqCst
                            ).is_ok() {
                            PermissionResponse::Allow
                        } else {
                            PermissionResponse::Default
                        }
                    }
                })
                .initialization_script(script.clone())
                // The observer reports a presented frame after the native
                // webview becomes visible. PageLoad Finished nudges its check.
                .initialization_script_for_all_frames(include_str!(
                    "../../../injected/observer.js"
                ))
                // Theme and masthead CSS are installed synchronously by the
                // initialization script. Only the first app startup uses the
                // native loading handoff; later page navigations remain visible.
                .on_page_load(|webview, payload| {
                    let app = webview.app_handle().clone();

                    match payload.event() {
                        tauri::webview::PageLoadEvent::Started => {
                            let top_url = webview
                                .url()
                                .ok()
                                .map(|u| u.to_string())
                                .unwrap_or_default();
                            let is_top_login = (top_url.contains("accounts.google.com/ServiceLogin")
                                || top_url.contains("accounts.google.com/v3/signin")
                                || top_url.contains("accounts.google.com/InteractiveLogin"))
                                && payload.url().as_str() == top_url;
                            if is_top_login {
                                let _ = webview.eval("location.href = 'https://www.youtube.com';");
                                return;
                            }
                        }
                        tauri::webview::PageLoadEvent::Finished => {
                            let Some(top_url) = webview.url().ok() else {
                                return;
                            };
                            let is_youtube_page = top_url
                                .host_str()
                                .map(|host| host == "youtube.com" || host.ends_with(".youtube.com"))
                                .unwrap_or(false);
                            if !is_youtube_page {
                                return;
                            }
                            if payload.url().as_str() != top_url.as_str() {
                                return;
                            }

                            let _ = webview.eval(
                                "if (window.__ytdesktopReportTitlebarIcons) window.__ytdesktopReportTitlebarIcons(); if (window.__ytdesktopRequestAuthSnapshot) window.__ytdesktopRequestAuthSnapshot(); if (window.__ytdesktopReportNavState) window.__ytdesktopReportNavState();",
                            );

                            let is_active = webview.label() == active_youtube_label(&app);
                            if let Some(state) = app.try_state::<AppState>() {
                                if let Ok(mut manager) = state.tabs.lock() {
                                    if let Some(tab) = manager.tab_by_label_mut(webview.label()) {
                                        let next_url = top_url.to_string();
                                        if tab.url != next_url {
                                            tab.url = next_url;
                                            let _ = manager.save();
                                        }
                                    }
                                }
                            }
                            let needs_paint_report = app
                                .try_state::<AppState>()
                                .map(|state| {
                                    is_active
                                        && !state
                                            .painted_webviews
                                            .lock()
                                            .map(|set| set.contains(webview.label()))
                                            .unwrap_or(true)
                                })
                                .unwrap_or(false);
                            let visible = is_active
                                && app
                                    .try_state::<AppState>()
                                    .map(|state| state.youtube_visible.load(Ordering::SeqCst))
                                    .unwrap_or(true);
                            if visible {
                                let _ = webview.show();
                            } else {
                                let _ = webview.hide();
                            }
                            if needs_paint_report {
                                let _ = webview.eval(
                                    "window.__ytdesktopReportSurfacePainted && window.__ytdesktopReportSurfacePainted();",
                                );
                            }
                        }
                    }
                });

        if with_extensions {
            builder = builder.browser_extensions_enabled(true);
        }

        builder
    };

    let webview = match window.add_child(make(true), position, size) {
        Ok(webview) => webview,
        Err(_) => {
        // Some WebView2 runtimes cannot load browser extensions. Fall back to a
        // regular webview so the app still starts; extensions can be revisited
        // after a runtime update.
            window.add_child(make(false), position, size)?
        }
    };
    #[cfg(windows)]
    super::webview_popups::watch(window, &webview);
    if muted {
        let _ = set_webview_muted(window, &webview_label, true);
    }

    Ok(())
}

/// Records the startup-cover state shared with the launcher webview.
fn set_loading(app: &tauri::AppHandle, loading: bool) {
    if let Some(state) = app.try_state::<crate::core::state::AppState>() {
        state
            .youtube_loading
            .store(loading, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Computes the YouTube webview position and size for the current window.
fn youtube_bounds(window: &Window) -> AppResult<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let size = window.inner_size()?;
    let scale = window.scale_factor()?.max(0.0001);
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    let (left, top, bottom) = chrome_insets(window);

    Ok((
        LogicalPosition::new(left, top),
        LogicalSize::new((width - left).max(0.0), (height - top - bottom).max(0.0)),
    ))
}

/// Aligns a single YouTube tab webview to the current content bounds.
pub fn sync_youtube_webview_bounds(window: &Window, webview: &tauri::Webview) -> AppResult<()> {
    let (yt_pos, yt_size) = youtube_bounds(window)?;
    webview.set_position(yt_pos)?;
    webview.set_size(yt_size)?;
    Ok(())
}

/// Repositions the webviews according to the current window size and elevation state.
pub fn layout_webviews(window: &Window) -> AppResult<()> {
    let scale = window.scale_factor()?.max(0.0001);
    let size = window.inner_size()?;
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    let (left, top, bottom) = chrome_insets(window);
    let yt_pos = LogicalPosition::new(left, top);
    let yt_size = LogicalSize::new((width - left).max(0.0), (height - top - bottom).max(0.0));

    if let Some(ui) = window.get_webview(UI_WEBVIEW_LABEL) {
        ui.set_position(LogicalPosition::new(0.0, 0.0))?;
        ui.set_size(LogicalSize::new(width.max(0.0), height.max(0.0)))?;
    }

    let active_label = active_youtube_label(window.app_handle());
    if let Some(youtube) = window.get_webview(&active_label) {
        youtube.set_position(yt_pos)?;
        youtube.set_size(yt_size)?;
    }

    let (is_floating, dock_peek) = window
        .app_handle()
        .try_state::<AppState>()
        .map(|s| {
            let floating = s
                .settings
                .read()
                .ok()
                .map(|st| {
                    let tabs = st.snapshot().tabs;
                    tabs.enabled && tabs.layout == crate::settings::model::TabLayout::Floating
                })
                .unwrap_or(false);
            let peek = s.dock_peek.load(std::sync::atomic::Ordering::SeqCst);
            (floating, peek)
        })
        .unwrap_or((false, false));

    if let Some(dock) = window.get_webview(TAB_DOCK_WEBVIEW_LABEL) {
        if is_floating && dock_peek {
            if let Ok((dock_pos, dock_size)) = tab_dock_bounds(window) {
                let _ = dock.set_position(dock_pos);
                let _ = dock.set_size(dock_size);
            }
            let _ = dock.show();
        } else {
            let _ = dock.hide();
        }
    }

    #[cfg(target_os = "windows")]
    {
        let (elevated, ui_elevated, youtube_loading) = window
            .app_handle()
            .try_state::<AppState>()
            .map(|state| {
                let ordering = std::sync::atomic::Ordering::SeqCst;
                let ui_el = state.ui_elevated.load(ordering);
                let yt_load = state.youtube_loading.load(ordering);
                let elev = ui_el
                    || state.launcher_route_active.load(ordering)
                    || state.sidebar_peek.load(ordering)
                    || yt_load;
                (elev, ui_el, yt_load)
            })
            .unwrap_or((false, false, false));
        let active_label = active_youtube_label(window.app_handle());
        if !elevated {
            let _ = bring_webview_to_front(window, &active_label);
        }
        set_ui_webview_z_order(window, elevated)?;
        if is_floating && dock_peek && !ui_elevated && !youtube_loading {
            let _ = bring_webview_to_front(window, TAB_DOCK_WEBVIEW_LABEL);
        }
    }

    Ok(())
}

pub fn layout_active_youtube_only(window: &Window) -> AppResult<()> {
    let scale = window.scale_factor()?.max(0.0001);
    let size = window.inner_size()?;
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;
    let (left, top, bottom) = chrome_insets(window);
    let yt_pos = LogicalPosition::new(left, top);
    let yt_size = LogicalSize::new((width - left).max(0.0), (height - top - bottom).max(0.0));
    if let Some(youtube) = active_youtube_webview(window) {
        youtube.set_position(yt_pos)?;
        youtube.set_size(yt_size)?;
    }
    Ok(())
}

/// Raises a specific child webview HWND to the top of sibling webviews.
#[cfg(target_os = "windows")]
pub fn bring_webview_to_front(window: &Window, label: &str) -> AppResult<()> {
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(
            hwnd: *mut c_void,
            insert_after: *mut c_void,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
    }

    if let Some(webview) = window.get_webview(label) {
        let _ = webview.with_webview(|platform| unsafe {
            let mut hwnd = Default::default();
            if platform.controller().ParentWindow(&mut hwnd).is_ok() {
                const KEEP_BOUNDS_AND_FOCUS: u32 = 0x0001 | 0x0002 | 0x0010 | 0x0200;
                SetWindowPos(hwnd.0, std::ptr::null_mut(), 0, 0, 0, 0, KEEP_BOUNDS_AND_FOCUS);
            }
        });
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn bring_webview_to_front(_window: &Window, _label: &str) -> AppResult<()> {
    Ok(())
}

/// The two WebViews are native siblings, so CSS z-index cannot order them.
/// Raise the launcher for local pages or popups.
#[cfg(target_os = "windows")]
fn set_ui_webview_z_order(window: &Window, elevated: bool) -> AppResult<()> {
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        fn SetWindowPos(
            hwnd: *mut c_void,
            insert_after: *mut c_void,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
    }

    if let Some(ui) = window.get_webview(UI_WEBVIEW_LABEL) {
        ui.with_webview(move |platform| unsafe {
            let mut hwnd = Default::default();
            if platform.controller().ParentWindow(&mut hwnd).is_ok() {
                let after = if elevated { std::ptr::null_mut() } else { 1usize as *mut c_void };
                const KEEP_BOUNDS_AND_FOCUS: u32 = 0x0001 | 0x0002 | 0x0010 | 0x0200;
                SetWindowPos(hwnd.0, after, 0, 0, 0, 0, KEEP_BOUNDS_AND_FOCUS);
            }
        })?;
    }
    Ok(())
}

fn observe_window(window: &Window) {
    let handle = window.clone();
    window.on_window_event(move |event| match event {
        #[cfg(windows)]
        WindowEvent::Destroyed => super::webview_popups::unwatch(&handle),
        WindowEvent::Resized(_)
        | WindowEvent::Moved(_)
        | WindowEvent::ScaleFactorChanged { .. } => {
            let _ = layout_webviews(&handle);
            remember_window_size(&handle);
            sync_auth_modal_position(&handle);

            // Restoring the window brings the page back; the mini player is no
            // longer needed. Focus alone is unreliable here because the mini
            // player is always on top.
            if !handle.is_minimized().unwrap_or(true) {
                close_pip(&handle.app_handle());
            }
        }
        WindowEvent::CloseRequested { .. } => {
            persist_window_state(&handle);
            if let Some(state) = handle.app_handle().try_state::<AppState>() {
                state.native_pip_active.store(false, std::sync::atomic::Ordering::SeqCst);
            }
            set_native_pip_taskbar(&handle.app_handle(), false);
            if let Some(youtube) = active_youtube_webview(&handle) {
                let _ = youtube.eval("if (document.pictureInPictureElement) document.exitPictureInPicture().catch(()=>{});");
            }
            // The mini player is part of this window: closing the app closes it
            // too, instead of leaving a floating picture behind.
            if let Some(pip) = handle.app_handle().get_webview_window(PIP_WINDOW_LABEL) {
                let _ = pip.close();
            }
            if let Some(tray) = handle.app_handle().tray_by_id(crate::window::tray::TRAY_ID) {
                let _ = tray.set_visible(false);
            }
            // The menu and auth modal are separate hidden native windows. Exit
            // explicitly so closing the main window cannot leave them alive.
            handle.app_handle().exit(0);
        }
        WindowEvent::ThemeChanged(_) => {
            reapply_theme(&handle);
        }
        WindowEvent::Focused(false) => {
            request_pip_if_configured(&handle);
            crate::window::tray::defer_minimize_to_tray(&handle);
        }
        WindowEvent::Focused(true) => {
            if let Some(tray) = handle.app_handle().tray_by_id(crate::window::tray::TRAY_ID) {
                let _ = tray.set_visible(false);
            }
            close_pip(&handle.app_handle());
        }
        _ => {}
    });
}

#[derive(Default, Clone, Copy)]
struct PendingPipGeometry {
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
}

fn pending_pip_geometry() -> &'static std::sync::Mutex<PendingPipGeometry> {
    static PENDING: std::sync::OnceLock<std::sync::Mutex<PendingPipGeometry>> =
        std::sync::OnceLock::new();
    PENDING.get_or_init(|| std::sync::Mutex::new(PendingPipGeometry::default()))
}

fn flush_pending_pip_geometry(app: &tauri::AppHandle, persist: bool) {
    let pending = {
        let Ok(mut guard) = pending_pip_geometry().lock() else {
            return;
        };
        let snapshot = *guard;
        *guard = PendingPipGeometry::default();
        snapshot
    };
    if pending.x.is_none() && pending.width.is_none() && !persist {
        return;
    }
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };
    let Ok(mut store) = state.settings.write() else {
        return;
    };
    if pending.x.is_some() || pending.width.is_some() {
        let current = store.snapshot().pip;
        let width = pending.width.unwrap_or(current.width);
        let height = pending.height.unwrap_or(current.height);
        store.set_pip_geometry(pending.x, pending.y, width, height);
    }
    if persist {
        let next = store.snapshot();
        let _ = store.replace(next);
    }
}

/// Follows the mini player move/resize and buffers its geometry without taking
/// the global settings write lock on every dragged pixel.
fn remember_pip_geometry(app: &tauri::AppHandle, pip: &tauri::WebviewWindow) {
    let handle = app.clone();
    pip.on_window_event(move |event| {
        if crate::commands::window::PIP_DRAGGING.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        match event {
            WindowEvent::Moved(position) => {
                if let Ok(scale) = pip_scale(&handle) {
                    if let Ok(mut guard) = pending_pip_geometry().lock() {
                        guard.x = Some(position.x as f64 / scale);
                        guard.y = Some(position.y as f64 / scale);
                    }
                    schedule_pip_save(&handle);
                }
            }
            WindowEvent::Resized(size) => {
                if let Ok(scale) = pip_scale(&handle) {
                    if let Ok(mut guard) = pending_pip_geometry().lock() {
                        guard.width = Some(size.width as f64 / scale);
                        guard.height = Some(size.height as f64 / scale);
                    }
                    schedule_pip_save(&handle);
                }
            }
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                flush_pending_pip_geometry(&handle, true);
            }
            _ => {}
        }
    });
}

fn pip_scale(app: &tauri::AppHandle) -> Result<f64, ()> {
    app.get_webview_window(PIP_WINDOW_LABEL)
        .and_then(|window| window.scale_factor().ok())
        .map(|scale| scale.max(0.0001))
        .ok_or(())
}

/// Closes the mini player when the main window is back in front and resumes the
/// video it paused, so playback never stops on the way back to the app.
pub fn close_pip(app: &tauri::AppHandle) {
    let custom_pip_open = app.get_webview_window(PIP_WINDOW_LABEL).is_some();
    if let Some(pip) = app.get_webview_window(PIP_WINDOW_LABEL) {
        let _ = pip.close();
    }

    if let Some(state) = app.try_state::<AppState>() {
        state
            .native_pip_active
            .store(false, std::sync::atomic::Ordering::SeqCst);
    }
    set_native_pip_taskbar(app, false);
    if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
        if let Some(youtube) = active_youtube_webview(&window) {
            let _ = youtube.eval("if (document.pictureInPictureElement) document.exitPictureInPicture().catch(()=>{});");
        }
    }

    if !custom_pip_open {
        return;
    }

    if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
        if let Some(youtube) = active_youtube_webview(&window) {
            let _ = youtube.eval(
                "(function(){const v=document.querySelector('video');if(v&&v.paused){v.play().catch(()=>{});}return true;})()",
            );
        }
    }
}

#[cfg(target_os = "windows")]
pub fn set_native_pip_taskbar(app: &tauri::AppHandle, active: bool) {
    use std::ffi::c_void;
    use std::sync::{Mutex, OnceLock};

    #[repr(C)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }
    struct Context {
        owner: isize,
    }

    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(
            callback: unsafe extern "system" fn(*mut c_void, isize) -> i32,
            data: isize,
        ) -> i32;
        fn GetWindow(hwnd: *mut c_void, command: u32) -> *mut c_void;
        fn GetAncestor(hwnd: *mut c_void, flags: u32) -> *mut c_void;
        fn GetWindowRect(hwnd: *mut c_void, rect: *mut Rect) -> i32;
        fn GetClassNameW(hwnd: *mut c_void, name: *mut u16, max_count: i32) -> i32;
        fn GetWindowTextW(hwnd: *mut c_void, text: *mut u16, max_count: i32) -> i32;
        fn GetWindowLongPtrW(hwnd: *mut c_void, index: i32) -> isize;
        fn SetWindowLongPtrW(hwnd: *mut c_void, index: i32, value: isize) -> isize;
        fn SetWindowPos(
            hwnd: *mut c_void,
            after: *mut c_void,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            flags: u32,
        ) -> i32;
    }

    const GA_ROOTOWNER: u32 = 3;
    const GW_OWNER: u32 = 4;
    const GWL_EXSTYLE: i32 = -20;
    const WS_EX_TOOLWINDOW: isize = 0x80;
    const WS_EX_APPWINDOW: isize = 0x40000;
    const SWP_NOSIZE: u32 = 0x0001;
    const SWP_NOMOVE: u32 = 0x0002;
    const SWP_NOACTIVATE: u32 = 0x0010;
    const SWP_NOOWNERZORDER: u32 = 0x0200;
    const SWP_FRAMECHANGED: u32 = 0x0020;
    static ORIGINAL_STYLES: OnceLock<Mutex<Vec<(isize, isize)>>> = OnceLock::new();
    let originals = ORIGINAL_STYLES.get_or_init(|| Mutex::new(Vec::new()));

    if !active {
        if let Ok(mut saved) = originals.lock() {
            for &(raw, style) in saved.iter() {
                let hwnd = raw as *mut c_void;
                unsafe {
                    SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style);
                    SetWindowPos(
                        hwnd,
                        std::ptr::null_mut(),
                        0,
                        0,
                        0,
                        0,
                        SWP_NOMOVE
                            | SWP_NOSIZE
                            | SWP_NOACTIVATE
                            | SWP_NOOWNERZORDER
                            | SWP_FRAMECHANGED,
                    );
                }
            }
            saved.clear();
        }
        return;
    }

    let Some(owner) = app
        .get_window(MAIN_WINDOW_LABEL)
        .and_then(|window| window.hwnd().ok())
    else {
        return;
    };
    let mut context = Context {
        owner: owner.0 as isize,
    };
    unsafe extern "system" fn update_window(raw: *mut c_void, data: isize) -> i32 {
        let context = &mut *(data as *mut Context);
        let owner = context.owner as *mut c_void;
        let mut class = [0u16; 128];
        let class_len = GetClassNameW(raw, class.as_mut_ptr(), class.len() as i32);
        if class_len <= 0
            || !String::from_utf16_lossy(&class[..class_len as usize])
                .starts_with("Chrome_WidgetWin")
        {
            return 1;
        }

        let mut title = [0u16; 256];
        let title_len = GetWindowTextW(raw, title.as_mut_ptr(), title.len() as i32);
        let title = String::from_utf16_lossy(&title[..title_len.max(0) as usize]).to_lowercase();
        let owned_by_app =
            !GetWindow(raw, GW_OWNER).is_null() && GetAncestor(raw, GA_ROOTOWNER) == owner;
        let picture_title =
            title.contains("picture-in-picture") || title.contains("picture in picture");
        if !owned_by_app && !picture_title {
            return 1;
        }
        if title.contains("mini player")
            || title == "menu"
            || title == "login"
            || title.contains("youtube client")
        {
            return 1;
        }

        let mut rect = Rect {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        if GetWindowRect(raw, &mut rect) == 0 {
            return 1;
        }
        let width = (rect.right - rect.left).abs();
        let height = (rect.bottom - rect.top).abs();
        let ratio = width as f64 / height.max(1) as f64;
        let video_shape = (220..=1100).contains(&width)
            && (124..=760).contains(&height)
            && (0.52..=2.35).contains(&ratio);
        if !video_shape {
            return 1;
        }

        if let Ok(mut saved) = ORIGINAL_STYLES
            .get_or_init(|| Mutex::new(Vec::new()))
            .lock()
        {
            let raw_value = raw as isize;
            if !saved.iter().any(|(handle, _)| *handle == raw_value) {
                let style = GetWindowLongPtrW(raw, GWL_EXSTYLE);
                let adjusted = (style | WS_EX_TOOLWINDOW) & !WS_EX_APPWINDOW;
                SetWindowLongPtrW(raw, GWL_EXSTYLE, adjusted);
                if GetWindowLongPtrW(raw, GWL_EXSTYLE) != adjusted {
                    return 1;
                }
                if SetWindowPos(
                    raw,
                    std::ptr::null_mut(),
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_FRAMECHANGED,
                ) != 0
                {
                    saved.push((raw_value, style));
                } else {
                    SetWindowLongPtrW(raw, GWL_EXSTYLE, style);
                }
            }
        }
        1
    }

    unsafe {
        EnumWindows(update_window, &mut context as *mut Context as isize);
    }
}

#[cfg(not(target_os = "windows"))]
pub fn set_native_pip_taskbar(_app: &tauri::AppHandle, _active: bool) {}

/// Creates (or reveals) the mini player for the video that is playing.
///
/// Window creation needs the event loop, so callers on the UI thread should
/// spawn this off the callback.
pub fn open_pip(app: &tauri::AppHandle) -> AppResult<()> {
    let settings = app
        .try_state::<AppState>()
        .and_then(|state| state.settings.read().ok().map(|store| store.snapshot()))
        .unwrap_or_default();

    if !settings.pip.enabled {
        return Ok(());
    }

    if settings.pip.mode == crate::settings::model::PipMode::Native {
        if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
            if let Some(youtube) = active_youtube_webview(&window) {
                let _ = youtube.eval(
                    r#"(async function() {
                        const v = document.querySelector('video');
                        if (!v || document.pictureInPictureElement) return;
                        try {
                            await v.requestPictureInPicture();
                        } catch (e) {
                            console.error('Native PiP error:', e);
                        }
                    })()"#,
                );
            }
        }
        return Ok(());
    }

    if let Some(existing) = app.get_webview_window(PIP_WINDOW_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    crate::commands::window::reset_pip_time();

    let video_id = {
        let state = app
            .try_state::<AppState>()
            .ok_or_else(|| AppError::State("app not ready".into()))?;
        let active_id = state
            .tabs
            .lock()
            .map_err(|_| AppError::State("tabs unavailable".into()))?
            .active_tab_id()
            .to_string();

        let media = state
            .media_by_tab
            .lock()
            .map_err(|_| AppError::State("player unavailable".into()))?;

        let current = media
            .get(&active_id)
            .and_then(|entry| entry.last_player.as_ref())
            .ok_or_else(|| AppError::Validation("no video is playing".into()))?;

        // A paused video is not playing anywhere: the mini player is for what
        // is running, so nothing opens.
        if !current.is_playing {
            return Ok(());
        }

        current
            .video_id
            .clone()
            .ok_or_else(|| AppError::Validation("no video is playing".into()))?
    };

    if !video_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err(AppError::Validation("invalid video id".into()));
    }

    let geometry = app
        .try_state::<AppState>()
        .map(|state| {
            state
                .settings
                .read()
                .map(|store| store.snapshot().pip)
                .unwrap_or_default()
        })
        .unwrap_or_default();

    // The mini player shows a 16:9 video, so the window uses that same ratio:
    // any other shape letterboxes the picture.
    let width = geometry.width.max(320.0);
    let height = (width * 9.0 / 16.0).max(180.0);

    // `pip-player.js` is injected into every frame of this page, so it reaches
    // the player's own document, removes the logo the site draws over the video
    // and puts the window buttons in its place.
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        PIP_WINDOW_LABEL,
        tauri::WebviewUrl::App("pip.html".into()),
    )
    .title(format!("Mini player � {video_id}"))
    .inner_size(width, height)
    .min_inner_size(320.0, 180.0)
    .decorations(false)
    .resizable(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .visible(false)
    .background_color(Color(0, 0, 0, 255))
    .initialization_script_for_all_frames(include_str!("../../../injected/pip-player.js"));

    if let Some((x, y)) = restored_pip_position(app, &geometry) {
        builder = builder.position(x, y);
    }

    let pip = builder.build()?;

    // The builder resolves the size before the window has a scale factor, which
    // produces the wrong size on scaled displays. Applying it again now, with
    // the real scale factor, keeps the video area at the remembered size.
    let _ = pip.set_size(tauri::LogicalSize::new(width, height));

    // Any other shape stretches the picture while the user drags an edge, so
    // the window follows the 16:9 ratio of the video.
    lock_pip_aspect(&pip);

    remember_pip_geometry(app, &pip);
    #[cfg(windows)]
    if let (Some(main), Some(webview)) = (
        app.get_window(MAIN_WINDOW_LABEL),
        app.get_webview(PIP_WINDOW_LABEL),
    ) {
        super::webview_popups::watch(&main, &webview);
    }
    pip.show()?;
    let _ = pip.set_focus();

    // The mini player takes over playback so the same audio never plays twice.
    if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
        if let Some(youtube) = active_youtube_webview(&window) {
            let _ = youtube.eval(
                "(function(){const v=document.querySelector('video');if(v&&!v.paused){v.pause();}return true;})()",
            );
        }
    }

    Ok(())
}

use std::sync::atomic::{AtomicU64, Ordering};

static PIP_ASPECT_RATIO: AtomicU64 = AtomicU64::new(0);

pub fn set_pip_aspect_ratio(app: &tauri::AppHandle, ratio: f64) -> AppResult<()> {
    if !(0.4..=3.5).contains(&ratio) {
        return Err(AppError::Validation(format!("invalid ratio: {ratio}")));
    }

    PIP_ASPECT_RATIO.store(ratio.to_bits(), Ordering::SeqCst);

    if let Some(pip) = app.get_webview_window(PIP_WINDOW_LABEL) {
        let scale = pip.scale_factor().unwrap_or(1.0).max(0.0001);
        if let Ok(size) = pip.inner_size() {
            let width = (size.width as f64 / scale).clamp(240.0, 960.0);
            let height = (width / ratio).clamp(135.0, 720.0);
            let _ = pip.set_size(tauri::LogicalSize::new(width, height));
        }
    }

    Ok(())
}

pub fn current_pip_aspect_ratio() -> f64 {
    let bits = PIP_ASPECT_RATIO.load(Ordering::SeqCst);
    if bits == 0 {
        16.0 / 9.0
    } else {
        f64::from_bits(bits)
    }
}

/// Keeps the mini player at the ratio of the video while it is resized.
///
/// The axis the user is dragging wins, and the other one follows, so the window
/// never fights the pointer.
fn lock_pip_aspect(pip: &tauri::WebviewWindow) {
    use std::sync::{Arc, Mutex};

    let handle = pip.clone();
    let last = Arc::new(Mutex::new((0.0f64, 0.0f64)));

    let scale = pip.scale_factor().unwrap_or(1.0).max(0.0001);
    if let Ok(size) = pip.inner_size() {
        if let Ok(mut guard) = last.lock() {
            *guard = (size.width as f64 / scale, size.height as f64 / scale);
        }
    }

    pip.on_window_event(move |event| {
        let tauri::WindowEvent::Resized(size) = event else {
            return;
        };

        let scale = handle.scale_factor().unwrap_or(1.0).max(0.0001);
        let width = size.width as f64 / scale;
        let height = size.height as f64 / scale;

        let Ok(mut last) = last.lock() else {
            return;
        };

        let (last_width, last_height) = *last;
        if (width - last_width).abs() < 1.0 && (height - last_height).abs() < 1.0 {
            return;
        }

        let ratio = current_pip_aspect_ratio();
        let (target_width, target_height) =
            if (width - last_width).abs() >= (height - last_height).abs() {
                (width, width / ratio)
            } else {
                (height * ratio, height)
            };

        *last = (target_width, target_height);
        let _ = handle.set_size(tauri::LogicalSize::new(target_width, target_height));
    });
}

/// Returns the remembered mini player position, moved back inside the monitor
/// that overlaps it the most.
///
/// A saved position can land outside the desktop once a monitor is unplugged or
/// the resolution changes, and a borderless window left half off the screen is
/// nearly impossible to grab back.
fn restored_pip_position(
    app: &tauri::AppHandle,
    geometry: &crate::settings::model::PipWindowSettings,
) -> Option<(f64, f64)> {
    let (x, y) = (geometry.x?, geometry.y?);
    let (width, height) = (geometry.width.max(320.0), geometry.height.max(180.0));

    let monitors = app.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        return Some((x, y));
    }

    let mut best: Option<((f64, f64, f64, f64), f64)> = None;

    for monitor in &monitors {
        let scale = monitor.scale_factor().max(0.0001);
        let position = monitor.position();
        let size = monitor.size();

        let left = position.x as f64 / scale;
        let top = position.y as f64 / scale;
        let right = left + size.width as f64 / scale;
        let bottom = top + size.height as f64 / scale;

        let overlap_width = (x + width).min(right) - x.max(left);
        let overlap_height = (y + height).min(bottom) - y.max(top);
        let overlap = overlap_width.max(0.0) * overlap_height.max(0.0);

        if best.map(|(_, current)| overlap > current).unwrap_or(true) {
            best = Some(((left, top, right, bottom), overlap));
        }
    }

    let (left, top, right, bottom) = best?.0;

    // A window larger than the screen stays anchored to its top-left corner.
    Some((
        x.clamp(left, (right - width).max(left)),
        y.clamp(top, (bottom - height).max(top)),
    ))
}

/// Writes the mini player geometry after the drag settles, so resizing or
/// moving the window does not rewrite the settings file on every event.
fn schedule_pip_save(app: &tauri::AppHandle) {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};

    static GENERATION: AtomicU64 = AtomicU64::new(0);
    static SAVE_TIMER: OnceLock<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>> =
        OnceLock::new();

    let Ok(mut timer) = SAVE_TIMER.get_or_init(|| Mutex::new(None)).lock() else {
        return;
    };
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(previous) = timer.take() {
        previous.abort();
    }
    let handle = app.clone();

    *timer = Some(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(420)).await;
        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }

        flush_pending_pip_geometry(&handle, true);
    }));
}

/// Opens the mini player when the window is minimized or loses focus, if the
/// user enabled it. The decision runs off the event callback so creating a
/// window never blocks the event loop.
fn request_pip_if_configured(window: &Window) {
    use crate::core::state::AppState;

    let Some(state) = window.app_handle().try_state::<AppState>() else {
        return;
    };

    let settings = match state.settings.read() {
        Ok(store) => store.snapshot(),
        Err(_) => return,
    };

    if !settings.pip.enabled {
        return;
    }

    let general = settings.general;
    if !general.pip_on_blur && !general.pip_on_minimize {
        return;
    }

    let handle = window.clone();
    tauri::async_runtime::spawn(async move {
        // Focus moves before the window state settles; wait a moment so a
        // minimize is recognized as such.
        tokio::time::sleep(Duration::from_millis(260)).await;

        if matches!(handle.app_handle().get_webview_window("pip"), Some(pip) if pip.is_focused().unwrap_or(false))
        {
            return;
        }

        let minimized = handle.is_minimized().unwrap_or(false);
        let allowed = if minimized {
            general.pip_on_minimize
        } else {
            general.pip_on_blur
        };

        if !allowed {
            return;
        }

        // The webview may be suspended while the window is minimized, so the
        // mini player is created here instead of asking the UI to do it.
        if let Err(error) = open_pip(&handle.app_handle()) {
            eprintln!("pip: {error}");
        }
    });
}

fn logical_window_size(window: &Window) -> Option<(f64, f64)> {
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?.max(0.0001);
    Some((size.width as f64 / scale, size.height as f64 / scale))
}

/// Updates the in-memory restore size while the user drags the window. It is
/// intentionally not written to disk until the window closes.
fn remember_window_size(window: &Window) {
    if window.is_maximized().unwrap_or(false) {
        return;
    }

    let Some((width, height)) = logical_window_size(window) else {
        return;
    };

    if width < 960.0 || height < 600.0 {
        return;
    }

    use crate::core::state::AppState;
    if let Some(state) = window.app_handle().try_state::<AppState>() {
        if let Ok(mut store) = state.settings.write() {
            store.set_window_size(width, height);
        }
    }
}

fn persist_window_state(window: &Window) {
    let maximized = window.is_maximized().unwrap_or(false);
    let size = if maximized {
        None
    } else {
        logical_window_size(window)
    };

    use crate::core::state::AppState;
    let Some(state) = window.app_handle().try_state::<AppState>() else {
        return;
    };

    let Ok(mut store) = state.settings.write() else {
        return;
    };

    let mut next = store.snapshot();
    next.window.maximized = maximized;

    if let Some((width, height)) = size {
        if width >= 960.0 && height >= 600.0 {
            next.window.width = width;
            next.window.height = height;
        }
    }

    let _ = store.replace(next);
}

/// Re-applies the theme after the operating system theme changes, but only
/// while the user follows the system mode.
fn reapply_theme(window: &Window) {
    use crate::core::state::AppState;
    use crate::theme::model::ThemeMode;
    use crate::theme::service::ThemeService;

    let app = window.app_handle();
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let theme = match state.settings.read() {
        Ok(settings) => settings.snapshot().theme,
        Err(_) => return,
    };

    if theme.mode != ThemeMode::System {
        return;
    }

    let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
    if let Ok(resolved) = ThemeService::resolve(&theme, system_dark) {
        let _ = ThemeService::apply_to_window(window, &resolved);
        let _ = ThemeService::apply_to_youtube(window, &resolved);
        let _ = app.emit(crate::core::events::THEME_CHANGED, &resolved);
    }
}
