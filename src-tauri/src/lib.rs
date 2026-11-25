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
mod tabs;
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
            let sleep_handle = handle.clone();
            let sleep_window = youtube_window.clone();
            tauri::async_runtime::spawn(async move {
                watch_sleeping_tabs(sleep_handle, sleep_window).await;
            });
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(1200)).await;
                sync_extensions(&handle, &youtube_window, &webview_data_dir).await;
                watch_extensions_folder(handle, youtube_window, webview_data_dir).await;
            });

            let update_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_secs(4)).await;
                let (auto_check, include_prerelease) = update_handle
                    .try_state::<core::state::AppState>()
                    .and_then(|state| {
                        state.settings.read().ok().map(|s| {
                            let u = s.snapshot().updates;
                            (u.auto_check, u.include_prerelease)
                        })
                    })
                    .unwrap_or((false, true));
                if auto_check {
                    let _ = commands::updates::run_update_check(&update_handle, include_prerelease).await;
                }
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
            commands::window::youtube_nav_state,
            commands::window::request_youtube_nav_state,
            commands::window::youtube_voice_state,
            commands::window::youtube_context_menu,
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
            commands::tabs::tabs_snapshot,
            commands::tabs::tab_create,
            commands::tabs::tab_activate,
            commands::tabs::tab_close,
            commands::tabs::tab_close_others,
            commands::tabs::tab_reopen_closed,
            commands::tabs::tab_reorder,
            commands::tabs::tab_set_pinned,
            commands::tabs::tab_set_muted,
            commands::tabs::tab_duplicate,
            commands::tabs::tab_sleep,
            commands::tabs::tab_sidebar_peek,
            commands::tabs::tab_dock_peek,
            commands::tabs::set_sidebar_width,
            commands::tabs::tab_open_action_menu,
            commands::tabs::tabs_clear_isolated_data,
            commands::tabs::set_tab_dock_width,
            commands::tabs::tab_open_context_menu,
            commands::updates::updates_check,
            commands::updates::updates_last_status,
            commands::updates::updates_open_url,
            commands::player::player_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run YT Desktop");
}

/// Applies the enabled extensions to the WebView2 profile, rebuilding the
/// YouTube webview when the profile changed.
async fn watch_sleeping_tabs(handle: tauri::AppHandle, window: tauri::Window) {
    loop {
        tokio::time::sleep(Duration::from_secs(30)).await;
        let Some(state) = handle.try_state::<core::state::AppState>() else {
            return;
        };
        let auto_sleep_mins = state
            .settings
            .read()
            .map(|s| s.snapshot().tabs.auto_sleep_minutes)
            .unwrap_or(0);
        if auto_sleep_mins == 0 {
            continue;
        }
        let cutoff_ms = rpc::model::now_millis() - (auto_sleep_mins as i64 * 60_000);
        let mut slept_tabs: Vec<(String, String)> = Vec::new();
        let mut updated_snapshot = None;
        if let Ok(mut manager) = state.tabs.lock() {
            let active_id = manager.active_tab_id().to_string();
            let mut changed = false;
            let snap = manager.snapshot();
            for tab in snap.tabs {
                if tab.id != active_id
                    && !tab.pinned
                    && !tab.sleeping
                    && !tab.is_playing
                    && tab.last_active_at > 0
                    && tab.last_active_at < cutoff_ms
                {
                    if let Some(entry) = manager.tab_by_id_mut(&tab.id) {
                        entry.sleeping = true;
                        slept_tabs.push((entry.id.clone(), entry.webview_label.clone()));
                        changed = true;
                    }
                }
            }
            if changed {
                let _ = manager.save();
                updated_snapshot = Some(manager.snapshot());
            }
        }
        for (tab_id, label) in slept_tabs {
            if let Ok(mut media) = state.media_by_tab.lock() {
                media.remove(&tab_id);
            }
            if let Ok(mut active_rpc) = state.active_rpc_tab_id.lock() {
                if active_rpc.as_deref() == Some(tab_id.as_str()) {
                    *active_rpc = None;
                }
            }
            if let Ok(mut painted) = state.painted_webviews.lock() {
                painted.remove(&label);
            }
            if let Some(wv) = window.get_webview(&label) {
                #[cfg(windows)]
                window::webview_popups::unwatch_webview(&wv);
                let _ = wv.close();
            }
        }
        if let Some(snapshot) = updated_snapshot {
            let _ = handle.emit("tabs://updated", snapshot);
            let _ = commands::player::reconcile_rpc(&handle, &state);
        }
    }
}

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
