use std::path::Path;

use tauri::webview::WebviewBuilder;
use tauri::window::Color;
use tauri::{App, LogicalPosition, LogicalSize, Manager, WebviewUrl, Window, WindowEvent};

use crate::core::error::AppResult;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const UI_WEBVIEW_LABEL: &str = "ui";
pub const YOUTUBE_WEBVIEW_LABEL: &str = "yt";

/// Custom title bar height, in logical pixels.
pub const TITLEBAR_HEIGHT: f64 = 40.0;

/// Sidebar width, in logical pixels. Must match `--sidebar-width` in CSS.
pub const SIDEBAR_WIDTH: f64 = 232.0;

const INITIAL_WIDTH: f64 = 1280.0;
const INITIAL_HEIGHT: f64 = 800.0;

/// Creates the main window and the two webviews:
/// - `ui`: app interface, covering the entire window (title bar and sidebar).
/// - `yt`: YouTube, in the content area, with WebView2 extensions enabled.
pub fn setup(app: &mut App, extensions_dir: &Path) -> AppResult<Window> {
    let window = tauri::window::WindowBuilder::new(app, MAIN_WINDOW_LABEL)
        .title("YT Desktop")
        .inner_size(INITIAL_WIDTH, INITIAL_HEIGHT)
        .min_inner_size(960.0, 600.0)
        .decorations(false)
        .transparent(true)
        .build()?;

    let ui = WebviewBuilder::new(UI_WEBVIEW_LABEL, WebviewUrl::App("index.html".into()))
        .background_color(Color(0, 0, 0, 0));
    window.add_child(
        ui,
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(INITIAL_WIDTH, INITIAL_HEIGHT),
    )?;

    let youtube_url = "https://www.youtube.com"
        .parse()
        .expect("invalid YouTube URL");

    let mut youtube = WebviewBuilder::new(YOUTUBE_WEBVIEW_LABEL, WebviewUrl::External(youtube_url))
        .browser_extensions_enabled(true)
        .initialization_script_for_all_frames(include_str!("../../../injected/observer.js"));

    if std::fs::create_dir_all(extensions_dir).is_ok() {
        youtube = youtube.extensions_path(extensions_dir);
    }

    window.add_child(
        youtube,
        LogicalPosition::new(SIDEBAR_WIDTH, TITLEBAR_HEIGHT),
        LogicalSize::new(
            (INITIAL_WIDTH - SIDEBAR_WIDTH).max(0.0),
            (INITIAL_HEIGHT - TITLEBAR_HEIGHT).max(0.0),
        ),
    )?;

    layout_webviews(&window)?;
    observe_window(&window);

    Ok(window)
}

/// Repositions the webviews according to the current window size.
fn layout_webviews(window: &Window) -> AppResult<()> {
    let scale = window.scale_factor()?;
    let size = window.inner_size()?;
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;

    if let Some(ui) = window.get_webview(UI_WEBVIEW_LABEL) {
        ui.set_position(LogicalPosition::new(0.0, 0.0))?;
        ui.set_size(LogicalSize::new(width, height))?;
    }

    if let Some(youtube) = window.get_webview(YOUTUBE_WEBVIEW_LABEL) {
        youtube.set_position(LogicalPosition::new(SIDEBAR_WIDTH, TITLEBAR_HEIGHT))?;
        youtube.set_size(LogicalSize::new(
            (width - SIDEBAR_WIDTH).max(0.0),
            (height - TITLEBAR_HEIGHT).max(0.0),
        ))?;
    }

    Ok(())
}

fn observe_window(window: &Window) {
    let handle = window.clone();
    window.on_window_event(move |event| {
        if matches!(
            event,
            WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. }
        ) {
            let _ = layout_webviews(&handle);
        }
    });
}
