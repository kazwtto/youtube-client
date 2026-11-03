use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU64, Ordering};

use tauri::{Emitter, Manager, State, Window};

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
        let current = state.youtube_visible.load(Ordering::SeqCst);
        if current == visible {
            return Ok(());
        }
        state.youtube_visible.store(visible, Ordering::SeqCst);
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

    let _ = crate::window::layout::layout_webviews(&window);

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
        "back" => "history.back()".to_string(),
        "forward" => "history.forward()".to_string(),
        "home" => "location.href = 'https://www.youtube.com'".to_string(),
        "reload" => "location.reload()".to_string(),
        "guide" => r#"
        (function() {
          const guideBtn = document.querySelector('yt-icon-button#guide-button button, #guide-button #button, #guide-button button, yt-icon-button#guide-button');
          if (guideBtn) {
            guideBtn.click();
            return;
          }
          const app = document.querySelector('ytd-app');
          if (app && typeof app.fire === 'function') {
            app.fire('yt-action', { actionName: 'yt-toggle-guide-action' });
            return;
          }
          const drawer = document.querySelector('tp-yt-app-drawer');
          if (drawer && typeof drawer.toggle === 'function') {
            drawer.toggle();
          }
        })()
        "#.to_string(),
        "avatar" => "(function(){ const b = document.querySelector('#avatar-btn, ytd-topbar-menu-button-renderer #avatar-btn, button#avatar-btn'); if (b) b.click(); })()".to_string(),
        "voice" => "(function(){ const b = document.querySelector('#voice-search-button button, yt-icon-button#voice-search-button button, #voice-search-button'); if (b) b.click(); })()".to_string(),
        act if act.starts_with("search:") => {
            let query = &act[7..];
            format!(
                r#"
                (function() {{
                    var q = decodeURIComponent('{query}');
                    var box = document.querySelector('ytd-searchbox');
                    var input = document.querySelector('input#search');
                    if (box && input) {{
                        input.value = q;
                        input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                        var form = box.querySelector('#search-form');
                        if (form) {{
                            form.dispatchEvent(new Event('submit', {{ bubbles: true, cancelable: true }}));
                            return;
                        }}
                    }}
                    location.href = 'https://www.youtube.com/results?search_query={query}';
                }})()
                "#
            )
        }
        act if act.starts_with("url:") => {
            let target = &act[4..];
            if target.contains("accounts.google.com") {
                return Ok(());
            }
            format!("location.href = '{}'", target.replace('\'', "\\'"))
        }
        act if act.starts_with("eval:") => {
            act[5..].to_string()
        }
        other => {
            return Err(AppError::Validation(format!(
                "unknown navigation action: {other}"
            )))
        }
    };

    webview.eval(&script)?;
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthSnapshot {
    pub logged_in: bool,
    pub avatar_url: Option<String>,
    pub display_name: Option<String>,
    pub handle: Option<String>,
}

/// Receives authentication status from the observer and emits to UI.
#[tauri::command]
pub fn auth_snapshot(window: Window, auth: AuthSnapshot) -> AppResult<()> {
    let _ = window.app_handle().emit(crate::core::events::AUTH_UPDATE, &auth);
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShowContextMenuArgs {
    pub x: f64,
    pub y: f64,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub auth: AuthSnapshot,
}

/// Positions and displays the native popover context menu window.
#[tauri::command]
pub fn show_context_menu(app: tauri::AppHandle, args: ShowContextMenuArgs) -> AppResult<()> {
    if let Some(menu) = app.get_webview_window(crate::window::layout::MENU_WINDOW_LABEL) {
        if let (Some(w), Some(h)) = (args.width, args.height) {
            let _ = menu.set_size(tauri::LogicalSize::new(w, h));
        }
        let _ = app.emit("menu://data", &args.auth);
        let _ = menu.set_position(tauri::LogicalPosition::new(args.x, args.y));
        let _ = menu.show();
        let _ = menu.set_focus();
    }
    Ok(())
}

/// Hides the native popover context menu window.
#[tauri::command]
pub fn hide_context_menu(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(menu) = app.get_webview_window(crate::window::layout::MENU_WINDOW_LABEL) {
        let _ = menu.hide();
        let _ = app.emit("menu://closed", ());
    }
    Ok(())
}

/// Checks whether the native context menu window is currently visible.
#[tauri::command]
pub fn is_context_menu_visible(app: tauri::AppHandle) -> AppResult<bool> {
    if let Some(menu) = app.get_webview_window(crate::window::layout::MENU_WINDOW_LABEL) {
        return Ok(menu.is_visible().unwrap_or(false));
    }
    Ok(false)
}

/// Opens the centered Google login modal over the main application.
#[tauri::command]
pub fn open_auth_modal(app: tauri::AppHandle) -> AppResult<()> {
    let main = app
        .get_window(crate::window::layout::MAIN_WINDOW_LABEL)
        .ok_or_else(|| AppError::State("main window not found".into()))?;
    let modal = app
        .get_window(crate::window::layout::AUTH_MODAL_WINDOW_LABEL)
        .ok_or_else(|| AppError::State("auth modal window not found".into()))?;

    let is_max = main.is_maximized().unwrap_or(false);
    if is_max {
        let _ = modal.maximize();
    } else {
        let _ = modal.unmaximize();
        if let Ok(pos) = main.inner_position() {
            let _ = modal.set_position(pos);
        }
        if let Ok(size) = main.inner_size() {
            let _ = modal.set_size(size);
        }
    }

    let scale = modal
        .scale_factor()
        .unwrap_or_else(|_| main.scale_factor().unwrap_or(1.0))
        .max(0.0001);
    let size = modal
        .inner_size()
        .unwrap_or_else(|_| main.inner_size().unwrap());

    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;

    let card_w = (width * 0.50).max(440.0).min(640.0).round();
    let card_h = (height * 0.60).max(480.0).min(700.0).round();
    let card_x = ((width - card_w) / 2.0).round();
    let card_y = ((height - card_h) / 2.0).round();
    let header_h = 44.0;

    if let Some(auth_ui) = modal.get_webview(crate::window::layout::AUTH_UI_WEBVIEW_LABEL) {
        let _ = auth_ui.set_position(tauri::LogicalPosition::new(0.0, 0.0));
        let _ = auth_ui.set_size(tauri::LogicalSize::new(width, height));
    }

    if let Some(auth_web) = modal.get_webview(crate::window::layout::AUTH_WEB_WEBVIEW_LABEL) {
        let _ = auth_web.set_position(tauri::LogicalPosition::new(card_x, card_y + header_h));
        let _ = auth_web.set_size(tauri::LogicalSize::new(card_w, card_h - header_h));
        let _ = auth_web.eval("if (!location.href.includes('accounts.google.com')) { location.href = 'https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com'; }");
    }

    let _ = app.emit(
        "auth://modal-layout",
        serde_json::json!({
            "cardX": card_x,
            "cardY": card_y,
            "cardW": card_w,
            "cardH": card_h,
            "headerH": header_h
        }),
    );

    let _ = modal.show();
    let _ = modal.set_focus();

    Ok(())
}

/// Closes the centered Google login modal.
#[tauri::command]
pub fn close_auth_modal(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(modal) = app.get_window(crate::window::layout::AUTH_MODAL_WINDOW_LABEL) {
        let _ = modal.hide();
    }
    Ok(())
}

/// Reloads the Google login webview.
#[tauri::command]
pub fn reload_auth_modal(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(modal) = app.get_window(crate::window::layout::AUTH_MODAL_WINDOW_LABEL) {
        if let Some(web) = modal.get_webview(crate::window::layout::AUTH_WEB_WEBVIEW_LABEL) {
            let _ = web.eval("location.reload();");
        }
    }
    Ok(())
}

/// Navigates back within the Google login webview.
#[tauri::command]
pub fn back_auth_modal(app: tauri::AppHandle) -> AppResult<()> {
    if let Some(modal) = app.get_window(crate::window::layout::AUTH_MODAL_WINDOW_LABEL) {
        if let Some(web) = modal.get_webview(crate::window::layout::AUTH_WEB_WEBVIEW_LABEL) {
            let _ = web.eval("history.back();");
        }
    }
    Ok(())
}

/// Checks whether the Google login modal is currently visible.
#[tauri::command]
pub fn is_auth_modal_visible(app: tauri::AppHandle) -> AppResult<bool> {
    if let Some(modal) = app.get_window(crate::window::layout::AUTH_MODAL_WINDOW_LABEL) {
        return Ok(modal.is_visible().unwrap_or(false));
    }
    Ok(false)
}

/// Injects or removes the CSS that hides the masthead and collapses its height.
#[tauri::command]
pub fn set_masthead_integrated(window: Window, integrated: bool) -> AppResult<()> {
    let webview = window
        .get_webview(YOUTUBE_WEBVIEW_LABEL)
        .ok_or_else(|| AppError::NotFound("YouTube webview".into()))?;

    let script = if integrated {
        r#"
        (function() {
          let style = document.getElementById('ytdesktop-masthead-hide');
          if (!style) {
            style = document.createElement('style');
            style.id = 'ytdesktop-masthead-hide';
            style.textContent = `
              #masthead-container, ytd-masthead, #ticker.ytd-masthead, #interstitial.ytd-masthead {
                display: none !important;
                height: 0 !important;
                min-height: 0 !important;
                max-height: 0 !important;
                margin: 0 !important;
                padding: 0 !important;
                pointer-events: none !important;
                visibility: hidden !important;
              }
              :root, html, body, ytd-app {
                --ytd-masthead-height: 0px !important;
                --ytd-toolbar-offset: 0px !important;
              }
              ytd-page-manager#page-manager {
                margin-top: 0px !important;
                padding-top: 0px !important;
              }
              #guide.ytd-app, ytd-mini-guide-renderer.ytd-app, #contentContainer.tp-yt-app-drawer {
                top: 0px !important;
                padding-top: 0px !important;
              }
            `;
            (document.head || document.documentElement).appendChild(style);
          }
        })()
        "#
    } else {
        r#"
        (function() {
          const style = document.getElementById('ytdesktop-masthead-hide');
          if (style) style.remove();
        })()
        "#
    };

    webview.eval(script)?;
    Ok(())
}

/// Adjusts the bounds of the UI webview so that dropdown menus and suggestions
/// rendered by the UI webview appear over the YouTube webview when open.
#[tauri::command]
pub fn set_ui_elevation(
    window: Window,
    state: State<'_, AppState>,
    elevated: bool,
) -> AppResult<()> {
    state.ui_elevated.store(elevated, Ordering::SeqCst);
    crate::window::layout::layout_webviews(&window)?;
    Ok(())
}

/// Fetches search suggestions directly via WinINet without browser CORS restrictions.
#[tauri::command]
pub fn yt_suggest(query: String) -> AppResult<Vec<String>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;
        use std::os::windows::ffi::OsStrExt;

        let encoded = urlencoding(trimmed);
        let url = format!("https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q={encoded}");
        let url_wide: Vec<u16> = std::ffi::OsStr::new(&url)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let agent_wide: Vec<u16> = std::ffi::OsStr::new("Mozilla/5.0")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        #[link(name = "wininet")]
        extern "system" {
            fn InternetOpenW(
                lpszAgent: *const u16,
                dwAccessType: u32,
                lpszProxy: *const u16,
                lpszProxyBypass: *const u16,
                dwFlags: u32,
            ) -> *mut c_void;
            fn InternetOpenUrlW(
                hInternet: *mut c_void,
                lpszUrl: *const u16,
                lpszHeaders: *const u16,
                dwHeadersLength: u32,
                dwFlags: u32,
                dwContext: usize,
            ) -> *mut c_void;
            fn InternetReadFile(
                hFile: *mut c_void,
                lpBuffer: *mut u8,
                dwNumberOfBytesToRead: u32,
                lpdwNumberOfBytesRead: *mut u32,
            ) -> i32;
            fn InternetCloseHandle(hInternet: *mut c_void) -> i32;
        }

        unsafe {
            let h_internet = InternetOpenW(
                agent_wide.as_ptr(),
                1, /* INTERNET_OPEN_TYPE_DIRECT */
                std::ptr::null(),
                std::ptr::null(),
                0,
            );
            if !h_internet.is_null() {
                let h_url = InternetOpenUrlW(
                    h_internet,
                    url_wide.as_ptr(),
                    std::ptr::null(),
                    0,
                    0x8000_0000, /* INTERNET_FLAG_RELOAD */
                    0,
                );
                if !h_url.is_null() {
                    let mut buffer = Vec::new();
                    let mut chunk = [0u8; 4096];
                    let mut bytes_read = 0u32;
                    while InternetReadFile(
                        h_url,
                        chunk.as_mut_ptr(),
                        chunk.len() as u32,
                        &mut bytes_read,
                    ) != 0
                        && bytes_read > 0
                    {
                        buffer.extend_from_slice(&chunk[..bytes_read as usize]);
                        if buffer.len() > 65536 {
                            break;
                        }
                    }

                    InternetCloseHandle(h_url);
                    InternetCloseHandle(h_internet);

                    if let Ok(text) = String::from_utf8(buffer) {
                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                            if let Some(arr) = val.get(1).and_then(|v| v.as_array()) {
                                let suggestions = arr
                                    .iter()
                                    .filter_map(|item| item.as_str().map(|s| s.to_string()))
                                    .collect();
                                return Ok(suggestions);
                            }
                        }
                    }
                } else {
                    InternetCloseHandle(h_internet);
                }
            }
        }
    }

    Ok(Vec::new())
}

fn urlencoding(input: &str) -> String {
    let mut encoded = String::new();
    for byte in input.bytes() {
        if byte.is_ascii_alphanumeric()
            || byte == b'-'
            || byte == b'_'
            || byte == b'.'
            || byte == b'~'
        {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{:02X}", byte));
        }
    }
    encoded
}
