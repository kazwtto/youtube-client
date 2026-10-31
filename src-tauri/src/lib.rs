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

use tauri::Manager;

/// Initializes and runs the application.
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let state = core::state::AppState::new(app.handle())?;

            let theme_settings = state
                .settings
                .read()
                .map_err(|_| core::error::AppError::State("settings unavailable".into()))?
                .snapshot()
                .theme;
            let extensions_dir = state.paths.extensions_dir.clone();

            app.manage(state);

            let window = window::layout::setup(app, &extensions_dir)?;

            // The theme is applied tolerantly: if the material is not
            // supported (e.g. Mica on older Windows versions), the app still
            // starts and the user can change the backdrop in settings.
            let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
            if let Ok(resolved) =
                theme::service::ThemeService::resolve(&theme_settings, system_dark)
            {
                let _ = theme::service::ThemeService::apply_to_window(&window, &resolved);
                let _ = theme::service::ThemeService::apply_to_youtube(&window, &resolved);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::window::app_version,
            commands::window::set_webview_visible,
            commands::window::yt_navigate,
            commands::theme::theme_list,
            commands::theme::theme_get,
            commands::theme::theme_update,
            commands::settings::settings_get,
            commands::settings::settings_update,
            commands::extensions::extensions_list,
            commands::extensions::extensions_install,
            commands::extensions::extensions_uninstall,
            commands::extensions::extensions_set_enabled,
            commands::rpc::rpc_status,
            commands::rpc::rpc_update,
            commands::history::history_list,
            commands::history::history_clear,
            commands::history::history_delete,
            commands::player::player_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run YT Desktop");
}
