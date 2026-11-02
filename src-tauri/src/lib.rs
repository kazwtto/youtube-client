//! YT Desktop — YouTube desktop client written in Rust.
//!
//! Domain architecture: `core` (errors, events, paths, and state), `settings`,
//! `theme`, `extensions`, `player`, `rpc`, `history`, and `window`. Tauri
//! commands live in `commands` and only orchestrate these domains.

#![allow(dead_code)]

mod commands;
mod core;
mod extensions;
mod history;
mod player;
mod rpc;
mod settings;
mod theme;
mod window;

use std::path::Path;
use std::sync::atomic::Ordering;

use tauri::Manager;

/// Initializes and runs the application.
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let state = core::state::AppState::new(app.handle())?;

            let settings = state
                .settings
                .read()
                .map_err(|_| core::error::AppError::State("settings unavailable".into()))?
                .snapshot();

            // WebView2 reads this variable when the first environment is
            // created, so it must be set before the window is built. It only
            // takes effect after a restart, which the settings page explains.
            if !settings.general.hardware_acceleration
                && std::env::var_os("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_none()
            {
                std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "--disable-gpu");
            }

            let webview_data_dir = state.paths.webview_data_dir.clone();
            app.manage(state);

            let window = window::layout::setup(app, &webview_data_dir, &settings.window)?;

            // The theme is applied tolerantly: if the material is not
            // supported (e.g. Mica on older Windows versions), the app still
            // starts and the user can change the backdrop in settings.
            let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
            if let Ok(resolved) =
                theme::service::ThemeService::resolve(&settings.theme, system_dark)
            {
                let _ = theme::service::ThemeService::apply_to_window(&window, &resolved);
                let _ = theme::service::ThemeService::apply_to_youtube(&window, &resolved);
            }

            // Reconcile the WebView2 extension set once the event loop is
            // running: the profile is only reachable from a live webview.
            let handle = app.handle().clone();
            let youtube_window = window.clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
                sync_extensions(&handle, &youtube_window, &webview_data_dir);
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::window::app_version,
            commands::window::set_webview_visible,
            commands::window::yt_navigate,
            commands::window::auth_snapshot,
            commands::window::set_masthead_integrated,
            commands::window::yt_play_video,
            commands::window::pip_open,
            commands::window::pip_current,
            commands::window::pip_restore,
            commands::window::pip_close,
            commands::window::pip_set_ratio,
            commands::window::pip_drag_start,
            commands::window::pip_move_by,
            commands::window::pip_drag_end,
            commands::window::pip_next,
            commands::window::pip_sync_time,
            commands::theme::theme_list,
            commands::theme::theme_get,
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::extensions::extensions_list,
            commands::extensions::extensions_install,
            commands::extensions::extensions_uninstall,
            commands::extensions::extensions_set_enabled,
            commands::rpc::rpc_status,
            commands::history::history_list,
            commands::history::history_clear,
            commands::history::history_delete,
            commands::player::player_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run YT Desktop");
}

/// Applies the enabled extensions to the WebView2 profile, rebuilding the
/// YouTube webview when the profile changed.
fn sync_extensions(handle: &tauri::AppHandle, window: &tauri::Window, webview_data_dir: &Path) {
    let Some(state) = handle.try_state::<core::state::AppState>() else {
        return;
    };

    let disabled = state
        .settings
        .read()
        .map(|store| store.snapshot().extensions.disabled)
        .unwrap_or_default();

    let Ok(list) = state.extensions.list(&disabled) else {
        return;
    };

    if !extensions::apply_runtime(window, &list) {
        return;
    }

    let visible = state.youtube_visible.load(Ordering::SeqCst);
    let _ = window::layout::reload_youtube(window, webview_data_dir, visible);
}
