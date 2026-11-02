use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};

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

/// Sets the aspect ratio of the video playing in picture-in-picture.
#[tauri::command]
pub fn pip_set_ratio(app: tauri::AppHandle, value: f64) -> AppResult<()> {
    crate::window::layout::set_pip_aspect_ratio(&app, value)
}

static PIP_CURRENT_TIME: AtomicU64 = AtomicU64::new(0);

/// Updates the current playback timestamp of the mini player for sync.
#[tauri::command]
pub fn pip_sync_time(time: f64) -> AppResult<()> {
    PIP_CURRENT_TIME.store(time.to_bits(), Ordering::SeqCst);
    Ok(())
}

pub fn current_pip_time() -> f64 {
    let bits = PIP_CURRENT_TIME.load(Ordering::SeqCst);
    if bits == 0 {
        0.0
    } else {
        f64::from_bits(bits)
    }
}

pub fn reset_pip_time() {
    PIP_CURRENT_TIME.store(0, Ordering::SeqCst);
}

#[cfg(target_os = "windows")]
mod win32 {
    use std::ffi::c_void;

    #[link(name = "user32")]
    extern "system" {
        pub fn ReleaseCapture() -> i32;
        pub fn SendMessageW(hwnd: *mut c_void, msg: u32, wparam: usize, lparam: isize) -> isize;
    }

    pub const WM_SYSCOMMAND: u32 = 0x0112;
    pub const SC_DRAGMOVE: usize = 0xF012;
}

pub static PIP_DRAGGING: AtomicBool = AtomicBool::new(false);
static PIP_TARGET_X: AtomicI32 = AtomicI32::new(0);
static PIP_TARGET_Y: AtomicI32 = AtomicI32::new(0);

/// Marks the start of a mini player drag, initiating native OS dragging.
#[tauri::command]
pub fn pip_drag_start(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(pip) = app.get_webview_window(crate::window::layout::PIP_WINDOW_LABEL) {
        #[cfg(target_os = "windows")]
        {
            if let Ok(hwnd) = pip.hwnd() {
                let hwnd_raw = hwnd.0 as isize;
                let pip_handle = pip.clone();
                let app_handle = app.clone();
                let _ = app.run_on_main_thread(move || {
                    PIP_DRAGGING.store(true, Ordering::SeqCst);
                    unsafe {
                        win32::ReleaseCapture();
                        win32::SendMessageW(
                            hwnd_raw as *mut std::ffi::c_void,
                            win32::WM_SYSCOMMAND,
                            win32::SC_DRAGMOVE,
                            0,
                        );
                    }
                    PIP_DRAGGING.store(false, Ordering::SeqCst);

                    if let Ok(pos) = pip_handle.outer_position() {
                        if let Ok(scale) = pip_handle.scale_factor() {
                            use crate::core::state::AppState;
                            if let Some(state) = app_handle.try_state::<AppState>() {
                                if let Ok(mut store) = state.settings.write() {
                                    let (width, height) =
                                        (store.snapshot().pip.width, store.snapshot().pip.height);
                                    store.set_pip_geometry(
                                        Some(pos.x as f64 / scale.max(0.0001)),
                                        Some(pos.y as f64 / scale.max(0.0001)),
                                        width,
                                        height,
                                    );
                                }
                            }
                        }
                    }
                });
                return Ok(());
            }
        }

        let _ = pip.start_dragging();
    }
    Ok(())
}

/// Moves the mini player window smoothly by relative physical pixels (fallback).
#[tauri::command]
pub fn pip_move_by(app: tauri::AppHandle, dx: i32, dy: i32) -> AppResult<()> {
    if !PIP_DRAGGING.load(Ordering::SeqCst) {
        return Ok(());
    }

    if let Some(pip) = app.get_webview_window(crate::window::layout::PIP_WINDOW_LABEL) {
        let scale = pip.scale_factor().unwrap_or(1.0).max(0.0001);
        let phys_dx = (dx as f64 * scale).round() as i32;
        let phys_dy = (dy as f64 * scale).round() as i32;

        let next_x = PIP_TARGET_X.fetch_add(phys_dx, Ordering::SeqCst) + phys_dx;
        let next_y = PIP_TARGET_Y.fetch_add(phys_dy, Ordering::SeqCst) + phys_dy;

        let _ = pip.set_position(tauri::PhysicalPosition::new(next_x, next_y));
    }
    Ok(())
}

/// Marks the end of a mini player drag and persists the final settled position.
#[tauri::command]
pub fn pip_drag_end(app: tauri::AppHandle) -> AppResult<()> {
    PIP_DRAGGING.store(false, Ordering::SeqCst);
    if let Some(pip) = app.get_webview_window(crate::window::layout::PIP_WINDOW_LABEL) {
        if let Ok(pos) = pip.outer_position() {
            if let Ok(scale) = pip.scale_factor() {
                use crate::core::state::AppState;
                if let Some(state) = app.try_state::<AppState>() {
                    if let Ok(mut store) = state.settings.write() {
                        let (width, height) = (store.snapshot().pip.width, store.snapshot().pip.height);
                        store.set_pip_geometry(
                            Some(pos.x as f64 / scale.max(0.0001)),
                            Some(pos.y as f64 / scale.max(0.0001)),
                            width,
                            height,
                        );
                    }
                }
            }
        }
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
