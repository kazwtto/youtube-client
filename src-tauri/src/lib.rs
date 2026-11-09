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

use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::time::{Duration, UNIX_EPOCH};

use tauri::{Emitter, Manager};

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
                sync_extensions(&handle, &youtube_window, &webview_data_dir).await;
                watch_extensions_folder(handle, youtube_window, webview_data_dir).await;
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::browser_data::browser_data_sources,
            commands::browser_data::browser_history_import,
            commands::browser_data::open_repository,
            commands::window::app_version,
            commands::window::set_webview_visible,
            commands::window::set_launcher_route_active,
            commands::window::yt_navigate,
            commands::window::auth_snapshot,
            commands::window::request_auth_snapshot,
            commands::window::youtube_loading_state,
            commands::window::youtube_surface_painted,
            commands::window::set_native_pip_active,
            commands::window::native_pip_return,
            commands::window::request_youtube_titlebar_icons,
            commands::window::youtube_titlebar_icons_snapshot,
            commands::window::show_context_menu,
            commands::window::hide_context_menu,
            commands::window::is_context_menu_visible,
            commands::window::open_auth_modal,
            commands::window::close_auth_modal,
            commands::window::reload_auth_modal,
            commands::window::back_auth_modal,
            commands::window::is_auth_modal_visible,
            commands::window::set_masthead_integrated,
            commands::window::set_ui_elevation,
            commands::window::yt_suggest,
            commands::window::yt_play_video,
            commands::window::remember_youtube_page,
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
            commands::extensions::extensions_refresh,
            commands::extensions::extensions_install,
            commands::extensions::extensions_uninstall,
            commands::extensions::extensions_set_enabled,
            commands::rpc::rpc_status,
            commands::history::history_list,
            commands::history::history_resume_position,
            commands::history::history_clear,
            commands::history::history_delete,
            commands::player::player_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run YT Desktop");
}

/// Applies the enabled extensions to the WebView2 profile, rebuilding the
/// YouTube webview when the profile changed.
async fn sync_extensions(
    handle: &tauri::AppHandle,
    window: &tauri::Window,
    webview_data_dir: &Path,
) {
    let Some(state) = handle.try_state::<core::state::AppState>() else {
        return;
    };

    let (disabled, custom_folder) = state
        .settings
        .read()
        .map(|store| {
            let snap = store.snapshot();
            (snap.extensions.disabled, snap.extensions.custom_folder)
        })
        .unwrap_or_default();

    if let Some(ref folder) = custom_folder {
        if folder.is_dir() {
            let _ = state.extensions.sync_folder(folder);
        }
    }

    let Ok(list) = state.extensions.list(&disabled) else {
        return;
    };

    let runtime_changed = extensions::apply_runtime(window, &list);
    let visible = state.youtube_visible.load(Ordering::SeqCst);
    drop(state);
    if runtime_changed {
        let _ = window::layout::reload_youtube(window, webview_data_dir, visible).await;
    }

    let _ = handle.emit(crate::core::events::EXTENSIONS_CHANGED, ());
}

async fn watch_extensions_folder(
    handle: tauri::AppHandle,
    window: tauri::Window,
    webview_data_dir: PathBuf,
) {
    let mut interval = tokio::time::interval(Duration::from_secs(3));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    interval.tick().await;

    let mut watched_folder: Option<PathBuf> = None;
    let mut applied_fingerprint = None;
    let mut pending_fingerprint = None;
    let mut stable_polls = 0;

    loop {
        interval.tick().await;
        let Some(state) = handle.try_state::<core::state::AppState>() else {
            return;
        };
        let folder = state
            .settings
            .read()
            .ok()
            .and_then(|store| store.snapshot().extensions.custom_folder);
        drop(state);

        if folder != watched_folder {
            watched_folder = folder.clone();
            applied_fingerprint = match folder.clone() {
                Some(folder) => tauri::async_runtime::spawn_blocking(move || {
                    extension_folder_fingerprint(&folder)
                })
                .await
                .ok()
                .flatten(),
                None => None,
            };
            pending_fingerprint = None;
            stable_polls = 0;
            continue;
        }

        let Some(folder) = folder else {
            continue;
        };
        let scan_folder = folder.clone();
        let Some(fingerprint) = tauri::async_runtime::spawn_blocking(move || {
            extension_folder_fingerprint(&scan_folder)
        })
        .await
        .ok()
        .flatten() else {
            continue;
        };
        if Some(fingerprint) == applied_fingerprint {
            pending_fingerprint = None;
            stable_polls = 0;
            continue;
        }

        if pending_fingerprint == Some(fingerprint) {
            stable_polls += 1;
        } else {
            pending_fingerprint = Some(fingerprint);
            stable_polls = 0;
        }
        if stable_polls == 0 {
            continue;
        }

        sync_extensions(&handle, &window, &webview_data_dir).await;
        let scan_folder = folder.clone();
        applied_fingerprint = tauri::async_runtime::spawn_blocking(move || {
            extension_folder_fingerprint(&scan_folder)
        })
        .await
        .ok()
        .flatten()
        .or(Some(fingerprint));
        pending_fingerprint = None;
        stable_polls = 0;
    }
}

fn extension_folder_fingerprint(folder: &Path) -> Option<u64> {
    if !folder.is_dir() {
        return None;
    }
    let mut hasher = DefaultHasher::new();
    folder.hash(&mut hasher);
    hash_extension_directory(folder, 2, &mut hasher)?;
    Some(hasher.finish())
}

fn hash_extension_directory(path: &Path, depth: u8, hasher: &mut DefaultHasher) -> Option<()> {
    let mut entries: Vec<_> = std::fs::read_dir(path).ok()?.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        entry.file_name().hash(hasher);
        let file_type = entry.file_type().ok()?;
        file_type.is_dir().hash(hasher);
        file_type.is_file().hash(hasher);
        file_type.is_symlink().hash(hasher);

        if let Ok(metadata) = entry.metadata() {
            metadata.len().hash(hasher);
            if let Ok(modified) = metadata.modified() {
                modified
                    .duration_since(UNIX_EPOCH)
                    .ok()?
                    .as_nanos()
                    .hash(hasher);
            }
        }

        if file_type.is_dir() && depth > 0 {
            hash_extension_directory(&entry.path(), depth - 1, hasher)?;
        }
    }
    Some(())
}
