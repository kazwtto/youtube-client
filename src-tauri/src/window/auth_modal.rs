use std::path::Path;

use tauri::webview::WebviewBuilder;
use tauri::window::Color;
use tauri::{Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, Window};

use crate::core::error::AppResult;

use super::layout::{
    active_youtube_webview, AUTH_MODAL_WINDOW_LABEL, AUTH_UI_WEBVIEW_LABEL,
    AUTH_WEB_WEBVIEW_LABEL, INITIAL_HEIGHT, INITIAL_WIDTH, MAIN_WINDOW_LABEL,
};

pub fn build_auth_web_webview(modal: &Window, data_dir: &Path) -> AppResult<()> {
    let _ = std::fs::create_dir_all(data_dir);
    let url: tauri::Url =
        "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com"
            .parse()
            .expect("invalid Google login URL");

    let auth_web_builder = WebviewBuilder::new(AUTH_WEB_WEBVIEW_LABEL, WebviewUrl::External(url))
        .data_directory(data_dir.to_path_buf())
        .browser_extensions_enabled(true)
        .background_color(Color(255, 255, 255, 255))
        .on_page_load(move |webview, payload| {
            if let tauri::webview::PageLoadEvent::Finished = payload.event() {
                let url_str = payload.url().as_str();
                if url_str.starts_with("https://www.youtube.com")
                    && !url_str.contains("ServiceLogin")
                {
                    let app = webview.app_handle().clone();
                    if let Some(modal) = app.get_window(AUTH_MODAL_WINDOW_LABEL) {
                        let _ = modal.hide();
                    }
                    if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
                        if let Some(yt) = active_youtube_webview(&main) {
                            let _ = yt.reload();
                        }
                    }
                }
            }
        });

    let card_w = 640.0;
    let card_h = 520.0;
    let card_x = (INITIAL_WIDTH - card_w) / 2.0;
    let card_y = (INITIAL_HEIGHT - card_h) / 2.0;
    let header_h = 44.0;

    modal.add_child(
        auth_web_builder,
        LogicalPosition::new(card_x, card_y + header_h),
        LogicalSize::new(card_w, card_h - header_h),
    )?;
    Ok(())
}

pub fn ensure_auth_modal_window(
    app: &tauri::AppHandle,
    webview_data_dir: &Path,
    auth_dir: &Path,
) -> AppResult<Window> {
    if let Some(existing) = app.get_window(AUTH_MODAL_WINDOW_LABEL) {
        return Ok(existing);
    }

    let window = tauri::window::WindowBuilder::new(app, AUTH_MODAL_WINDOW_LABEL)
        .title("Login")
        .inner_size(INITIAL_WIDTH, INITIAL_HEIGHT)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(true)
        .visible(false)
        .shadow(false)
        .background_color(Color(0, 0, 0, 0))
        .build()?;

    let ui_builder = WebviewBuilder::new(
        AUTH_UI_WEBVIEW_LABEL,
        tauri::WebviewUrl::App("auth-modal.html".into()),
    )
    .data_directory(webview_data_dir.join("ui"))
    .background_color(Color(0, 0, 0, 0));

    window.add_child(
        ui_builder,
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(INITIAL_WIDTH, INITIAL_HEIGHT),
    )?;

    build_auth_web_webview(&window, auth_dir)?;

    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;

        #[link(name = "dwmapi")]
        extern "system" {
            fn DwmSetWindowAttribute(
                hwnd: *mut c_void,
                dwAttribute: u32,
                pvAttribute: *const c_void,
                cbAttribute: u32,
            ) -> i32;
        }

        if let Ok(hwnd) = window.hwnd() {
            unsafe {
                let corner_pref: u32 = 1;
                let _ = DwmSetWindowAttribute(
                    hwnd.0 as *mut c_void,
                    33,
                    &corner_pref as *const _ as *const c_void,
                    std::mem::size_of::<u32>() as u32,
                );

                let border_color: u32 = 0xFFFFFFFE;
                let _ = DwmSetWindowAttribute(
                    hwnd.0 as *mut c_void,
                    34,
                    &border_color as *const _ as *const c_void,
                    std::mem::size_of::<u32>() as u32,
                );
            }
        }
    }

    Ok(window)
}

pub fn sync_auth_modal_position(main: &Window) {
    if let Some(modal) = main.app_handle().get_window(AUTH_MODAL_WINDOW_LABEL) {
        if modal.is_visible().unwrap_or(false) {
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

            if let (Ok(scale), Ok(size)) = (modal.scale_factor(), modal.inner_size()) {
                let scale = scale.max(0.0001);
                let width = size.width as f64 / scale;
                let height = size.height as f64 / scale;
                let card_w = (width * 0.50).max(440.0).min(640.0).round();
                let card_h = (height * 0.60).max(480.0).min(700.0).round();
                let card_x = ((width - card_w) / 2.0).round();
                let card_y = ((height - card_h) / 2.0).round();
                let header_h = 44.0;

                if let Some(ui) = modal.get_webview(AUTH_UI_WEBVIEW_LABEL) {
                    let _ = ui.set_position(tauri::LogicalPosition::new(0.0, 0.0));
                    let _ = ui.set_size(tauri::LogicalSize::new(width, height));
                }
                if let Some(web) = modal.get_webview(AUTH_WEB_WEBVIEW_LABEL) {
                    let _ =
                        web.set_position(tauri::LogicalPosition::new(card_x, card_y + header_h));
                    let _ = web.set_size(tauri::LogicalSize::new(card_w, card_h - header_h));
                }
                let _ = main.app_handle().emit(
                    "auth://modal-layout",
                    serde_json::json!({
                        "cardX": card_x,
                        "cardY": card_y,
                        "cardW": card_w,
                        "cardH": card_h,
                        "headerH": header_h
                    }),
                );
            }
        }
    }
}
