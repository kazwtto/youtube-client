use tauri::{Emitter, Manager, State};

use crate::core::error::{AppError, AppResult};
use crate::core::events;
use crate::core::state::AppState;
use crate::history::model::WatchEventInput;
use crate::player::PlayerSnapshot;
use crate::rpc::model::{app_id_for, build_activity, RpcStatus};
use crate::settings::AppSettings;

/// Receives player state from the observer injected into YouTube, forwards it to
/// the UI, records watch history, and updates the Discord presence.
#[tauri::command]
pub fn player_snapshot(
    window: tauri::Window,
    state: State<'_, AppState>,
    snapshot: PlayerSnapshot,
) -> AppResult<RpcStatus> {
    let _ = window.app_handle().emit(events::PLAYER_UPDATE, &snapshot);

    let track_changed = if let Ok(mut last) = state.last_player.lock() {
        let changed = last.as_ref().and_then(|value| value.video_id.clone()) != snapshot.video_id
            || last.as_ref().and_then(|value| value.title.clone()) != snapshot.title;
        *last = Some(snapshot.clone());
        changed
    } else {
        false
    };

    // Keeps an open mini player on the video the main window is on.
    if track_changed {
        if let Some(pip) = window.app_handle().get_webview_window("pip") {
            let _ = pip.emit("pip://player", snapshot.clone());
        }
    }

    let settings = state
        .settings
        .read()
        .map_err(|_| AppError::State("settings unavailable".into()))?
        .snapshot();

    record_history(&state, &settings, &snapshot)?;

    let app_id = app_id_for(&settings.rpc, snapshot.is_music());
    let mut rpc = state
        .rpc
        .lock()
        .map_err(|_| AppError::State("RPC service unavailable".into()))?;

    let status = match build_activity(&snapshot, &settings.rpc, &settings.general.language) {
        Some(activity) => rpc.update(&activity, &settings.rpc, app_id)?,
        None => rpc.clear(&settings.rpc)?,
    };

    let _ = window.app_handle().emit(events::RPC_STATUS, &status);
    Ok(status)
}

/// Feeds the watch tracker and persists an entry once a video crosses the
/// minimum watch time. Storing is detached so the player callback returns fast.
fn record_history(
    state: &AppState,
    settings: &AppSettings,
    snapshot: &PlayerSnapshot,
) -> AppResult<()> {
    let mut tracker = state
        .watch
        .lock()
        .map_err(|_| AppError::State("watch tracker unavailable".into()))?;

    if !settings.history.enabled {
        tracker.reset();
        return Ok(());
    }

    let Some(record) = tracker.observe(snapshot, settings.history.minimum_watch_secs as f64) else {
        return Ok(());
    };

    let repository = state.history.clone();
    let keep_thumbnails = settings.history.keep_thumbnails;
    let thumbnails_dir = state.paths.thumbnails_dir.clone();

    tauri::async_runtime::spawn(async move {
        let thumbnail_url = if keep_thumbnails {
            if let Some(url) = &record.thumbnail_url {
                let video_id = &record.video_id;
                let file_path = thumbnails_dir.join(format!("{}.jpg", video_id));
                let downloaded = if file_path.exists() {
                    true
                } else {
                    let u = url.clone();
                    let p = file_path.clone();
                    tokio::task::spawn_blocking(move || download_thumbnail(&u, &p))
                        .await
                        .unwrap_or(false)
                };

                if downloaded {
                    Some(file_path.to_string_lossy().to_string())
                } else {
                    record.thumbnail_url.clone()
                }
            } else {
                record.thumbnail_url.clone()
            }
        } else {
            None
        };

        let input = WatchEventInput {
            video_id: record.video_id,
            title: record.title,
            channel: record.channel,
            duration_secs: record.duration_secs,
            thumbnail_url,
            watched_at: None,
        };

        let _ = repository.record(input).await;
    });

    Ok(())
}

#[cfg(windows)]
fn download_thumbnail(url: &str, destination: &std::path::Path) -> bool {
    use std::os::windows::ffi::OsStrExt;

    let url_wide: Vec<u16> = std::ffi::OsStr::new(url)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let dest_wide: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    #[link(name = "urlmon")]
    extern "system" {
        fn URLDownloadToFileW(
            pCaller: *mut std::ffi::c_void,
            szURL: *const u16,
            szFileName: *const u16,
            dwReserved: u32,
            lpfnCB: *mut std::ffi::c_void,
        ) -> i32;
    }

    let hr = unsafe {
        URLDownloadToFileW(
            std::ptr::null_mut(),
            url_wide.as_ptr(),
            dest_wide.as_ptr(),
            0,
            std::ptr::null_mut(),
        )
    };

    hr == 0
}

#[cfg(not(windows))]
fn download_thumbnail(_url: &str, _destination: &std::path::Path) -> bool {
    false
}
