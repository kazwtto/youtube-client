use tauri::{Manager, Window};

use crate::core::error::{AppError, AppResult};
use crate::window::layout::YOUTUBE_WEBVIEW_LABEL;

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Shows or hides a webview (used to switch between UI and YouTube).
#[tauri::command]
pub fn set_webview_visible(window: Window, label: String, visible: bool) -> AppResult<()> {
    let webview = window
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("webview: {label}")))?;

    if visible {
        webview.show()?;
    } else {
        webview.hide()?;
    }

    Ok(())
}

/// Runs a navigation action in the YouTube webview.
#[tauri::command]
pub fn yt_navigate(window: Window, action: String) -> AppResult<()> {
    let webview = window
        .get_webview(YOUTUBE_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::NotFound("YouTube webview".into()))?;

    let script = match action.as_str() {
        "back" => "history.back()",
        "forward" => "history.forward()",
        "home" => "location.href = 'https://www.youtube.com'",
        "reload" => "location.reload()",
        other => {
            return Err(AppError::Validation(format!(
                "unknown navigation action: {other}"
            )))
        }
    };

    webview.eval(script)?;
    Ok(())
}
