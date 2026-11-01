use std::path::Path;
use std::time::Duration;

use tauri::webview::WebviewBuilder;
use tauri::window::Color;
use tauri::{App, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, Window, WindowEvent};

use crate::core::error::{AppError, AppResult};

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const UI_WEBVIEW_LABEL: &str = "ui";
pub const YOUTUBE_WEBVIEW_LABEL: &str = "yt";

/// Custom title bar height, in logical pixels. Must match `--titlebar-height`
/// in CSS.
pub const TITLEBAR_HEIGHT: f64 = 40.0;

const INITIAL_WIDTH: f64 = 1280.0;
const INITIAL_HEIGHT: f64 = 800.0;
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
pub fn setup(app: &mut App, webview_data_dir: &Path) -> AppResult<Window> {
    let window = tauri::window::WindowBuilder::new(app, MAIN_WINDOW_LABEL)
        .title("YT Desktop")
        .inner_size(INITIAL_WIDTH, INITIAL_HEIGHT)
        .min_inner_size(960.0, 600.0)
        .decorations(false)
        .transparent(true)
        .build()?;

    let ui = WebviewBuilder::new(UI_WEBVIEW_LABEL, WebviewUrl::App("index.html".into()))
        .data_directory(webview_data_dir.join("ui"))
        .background_color(Color(0, 0, 0, 0));
    window.add_child(
        ui,
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(INITIAL_WIDTH, INITIAL_HEIGHT),
    )?;

    add_youtube(&window, webview_data_dir)?;

    layout_webviews(&window)?;
    observe_window(&window);

    Ok(window)
}

/// Rebuilds the YouTube webview.
///
/// WebView2 reads the browser extension list only when a webview is created, so
/// enabling or disabling an extension requires recreating the webview. The
/// WebView2 environment is cached per data directory, so the profile (cookies,
/// login, extensions) is preserved. `visible` restores the current visibility,
/// which the caller tracks, because a new webview starts visible.
pub fn reload_youtube(window: &Window, webview_data_dir: &Path, visible: bool) -> AppResult<()> {
    if let Some(existing) = window.get_webview(YOUTUBE_WEBVIEW_LABEL) {
        let _ = existing.close();
    }

    let mut last_error = None;
    for attempt in 0..10 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(300));
        }

        match add_youtube(window, webview_data_dir) {
            Ok(()) => {
                if let Some(webview) = window.get_webview(YOUTUBE_WEBVIEW_LABEL) {
                    if visible {
                        let _ = webview.show();
                    } else {
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

fn add_youtube(window: &Window, webview_data_dir: &Path) -> AppResult<()> {
    let (position, size) = youtube_bounds(window)?;
    let url: tauri::Url = YOUTUBE_URL.parse().expect("invalid YouTube URL");

    let make = |with_extensions: bool| {
        let mut builder =
            WebviewBuilder::new(YOUTUBE_WEBVIEW_LABEL, WebviewUrl::External(url.clone()))
                .data_directory(webview_data_dir.join("yt"))
                .initialization_script(include_str!("../../../injected/theme.js"))
                .initialization_script_for_all_frames(include_str!(
                    "../../../injected/observer.js"
                ));

        if with_extensions {
            builder = builder.browser_extensions_enabled(true);
        }

        builder
    };

    if window.add_child(make(true), position, size).is_err() {
        // Some WebView2 runtimes cannot load browser extensions. Fall back to a
        // regular webview so the app still starts; extensions can be revisited
        // after a runtime update.
        window.add_child(make(false), position, size)?;
    }

    Ok(())
}

/// Computes the YouTube webview position and size for the current window.
fn youtube_bounds(window: &Window) -> AppResult<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let size = window.inner_size()?;
    let scale = window.scale_factor()?.max(0.0001);
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;

    Ok((
        LogicalPosition::new(0.0, TITLEBAR_HEIGHT),
        LogicalSize::new(width.max(0.0), (height - TITLEBAR_HEIGHT).max(0.0)),
    ))
}

/// Repositions the webviews according to the current window size.
fn layout_webviews(window: &Window) -> AppResult<()> {
    let scale = window.scale_factor()?.max(0.0001);
    let size = window.inner_size()?;
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;

    if let Some(ui) = window.get_webview(UI_WEBVIEW_LABEL) {
        ui.set_position(LogicalPosition::new(0.0, 0.0))?;
        ui.set_size(LogicalSize::new(width.max(0.0), height.max(0.0)))?;
    }

    if let Some(youtube) = window.get_webview(YOUTUBE_WEBVIEW_LABEL) {
        youtube.set_position(LogicalPosition::new(0.0, TITLEBAR_HEIGHT))?;
        youtube.set_size(LogicalSize::new(
            width.max(0.0),
            (height - TITLEBAR_HEIGHT).max(0.0),
        ))?;
    }

    Ok(())
}

fn observe_window(window: &Window) {
    let handle = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            let _ = layout_webviews(&handle);
        }
        WindowEvent::ThemeChanged(_) => {
            reapply_theme(&handle);
        }
        _ => {}
    });
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
