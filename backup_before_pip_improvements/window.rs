use std::sync::atomic::Ordering;

use tauri::{Manager, State, Window};

use crate::core::error::{AppError, AppResult};
use crate::core::state::AppState;
use crate::window::layout::YOUTUBE_WEBVIEW_LABEL;

#[tauri::command]
pub fn app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Shows or hides a webview (used to switch between UI and YouTube).
#[tauri::command]
pub fn set_webview_visible(
    window: Window,
    state: State<'_, AppState>,
    label: String,
    visible: bool,
) -> AppResult<()> {
    let webview = window
        .get_webview(&label)
        .ok_or_else(|| AppError::NotFound(format!("webview: {label}")))?;

    if label == YOUTUBE_WEBVIEW_LABEL {
        state.youtube_visible.store(visible, Ordering::SeqCst);

        // The site is hidden while the user is on the launcher pages. Apply the
        // current theme again right before showing it, so the first frame after
        // returning home already uses the latest settings instead of the theme
        // from the previous visit.
        if visible {
            use crate::theme::service::ThemeService;

            let theme = state
                .settings
                .read()
                .map(|store| store.snapshot().theme)
                .ok();
            let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));

            if let Some(theme) = theme {
                if let Ok(resolved) = ThemeService::resolve(&theme, system_dark) {
                    let _ = ThemeService::apply_to_youtube(&window, &resolved);
                }
            }
        }
    }

    // Never reveal a page that is still loading: the launcher shows its loading
    // state and the page-load handler reveals the site when it is ready.
    if visible {
        if state.youtube_loading.load(Ordering::SeqCst) {
            webview.hide()?;
            return Ok(());
        }

        webview.show()?;
    } else {
        webview.hide()?;
    }

    Ok(())
}

/// Opens a specific video in the YouTube webview.
#[tauri::command]
pub fn yt_play_video(window: Window, video_id: String) -> AppResult<()> {
    let valid = !video_id.is_empty()
        && video_id.len() <= 32
        && video_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_');

    if !valid {
        return Err(AppError::Validation(format!(
            "invalid video id: {video_id}"
        )));
    }

    let webview = window
        .get_webview(YOUTUBE_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::NotFound("YouTube webview".into()))?;

    webview.eval(&format!(
        "location.href = 'https://www.youtube.com/watch?v={video_id}'"
    ))?;
    Ok(())
}

/// Opens the picture-in-picture window for the video that is playing.
///
/// Async on purpose: building a window waits on the event loop, so a blocking
/// command would freeze the caller before the window exists.
#[tauri::command]
pub async fn pip_open(app: tauri::AppHandle) -> AppResult<()> {
    crate::window::layout::open_pip(&app)
}

/// Player state the mini player starts from, so it never has to guess the
/// video from a query string.
#[tauri::command]
pub fn pip_current(state: State<'_, AppState>) -> AppResult<Option<crate::player::PlayerSnapshot>> {
    let snapshot = state
        .last_player
        .lock()
        .map_err(|_| AppError::State("player unavailable".into()))?;

    Ok(snapshot.clone())
}

/// Brings the app back from the mini player.
///
/// Minimizing a borderless, taskbar-less window would leave it unreachable, so
/// the mini player restores the main window instead of minimizing itself.
#[tauri::command]
pub fn pip_restore(app: tauri::AppHandle) -> AppResult<()> {
    let Some(window) = app.get_window(crate::window::layout::MAIN_WINDOW_LABEL) else {
        return Err(AppError::NotFound("main window".into()));
    };

    let _ = window.unminimize();
    window.show()?;
    let _ = window.set_focus();

    // Closes the mini player through the shared path, so the video it paused
    // starts playing again on the way back to the app.
    crate::window::layout::close_pip(&app);

    Ok(())
}

/// Moves the mini player to the previous/next video of the current queue.
#[tauri::command]
pub async fn pip_next(app: tauri::AppHandle, direction: String) -> AppResult<()> {
    let window = app
        .get_window(crate::window::layout::MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::NotFound("main window".into()))?;

    let youtube = window
        .get_webview(YOUTUBE_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::NotFound("YouTube webview".into()))?;

    let script = match direction.as_str() {
        "next" => {
            "(function(){const b=document.querySelector('.ytp-next-button');if(b){b.click();return true;}return false;})()"
        }
        "prev" => {
            "(function(){const b=document.querySelector('.ytp-prev-button');if(b){b.click();return true;}history.back();return true;})()"
        }
        other => {
            return Err(AppError::Validation(format!(
                "unknown direction: {other}"
            )))
        }
    };

    youtube.eval(script)?;
    Ok(())
}

/// Closes the picture-in-picture window.
#[tauri::command]
pub async fn pip_close(app: tauri::AppHandle) -> AppResult<()> {
    crate::window::layout::close_pip(&app);
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
