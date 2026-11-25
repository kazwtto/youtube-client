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
    webview: tauri::Webview,
    window: tauri::Window,
    state: State<'_, AppState>,
    snapshot: PlayerSnapshot,
) -> AppResult<RpcStatus> {
    #[cfg(windows)]
    if snapshot.is_playing {
        crate::window::audio::refresh_session_icon();
    }

    let (tab_id, profile_id, is_active_tab) = if let Ok(mut manager) = state.tabs.lock() {
        let active_id = manager.active_tab_id().to_string();
        if let Some(tab) = manager.tab_by_label_mut(webview.label()) {
            let tid = tab.id.clone();
            let pid = tab.history_scope().to_string();
            let state_changed = tab.is_playing != snapshot.is_playing
                || snapshot.title.as_deref().is_some_and(|t| !t.is_empty() && t != tab.title);
            tab.is_playing = snapshot.is_playing;
            if let Some(title) = snapshot.title.as_deref().filter(|t| !t.trim().is_empty()) {
                tab.title = title.to_string();
            }
            if let Some(thumb) = snapshot.artwork_url.clone() {
                tab.thumbnail_url = Some(thumb);
            }
            let active = tid == active_id;
            if state_changed {
                let _ = window.app_handle().emit("tabs://updated", manager.snapshot());
            }
            (tid, pid, active)
        } else {
            (
                active_id.clone(),
                manager.active_history_scope().to_string(),
                true,
            )
        }
    } else {
        (
            "tab-1".to_string(),
            crate::tabs::DEFAULT_HISTORY_SCOPE.to_string(),
            true,
        )
    };

    if is_active_tab {
        let _ = window.app_handle().emit(events::PLAYER_UPDATE, &snapshot);
    }

    let track_changed = if let Ok(mut media) = state.media_by_tab.lock() {
        let entry = media.entry(tab_id.clone()).or_default();
        let changed = entry.last_player.as_ref().and_then(|value| value.video_id.clone())
            != snapshot.video_id
            || entry.last_player.as_ref().and_then(|value| value.title.clone()) != snapshot.title;
        entry.last_player = Some(snapshot.clone());
        entry.last_updated_ms = crate::rpc::model::now_millis();
        changed
    } else {
        false
    };

    if is_active_tab && track_changed {
        if let Some(pip) = window.app_handle().get_webview_window("pip") {
            let _ = pip.emit("pip://player", snapshot.clone());
        }
    }

    let settings = state
        .settings
        .read()
        .map_err(|_| AppError::State("settings unavailable".into()))?
        .snapshot();

    record_history(&state, &settings, &tab_id, &profile_id, &snapshot)?;

    reconcile_rpc(window.app_handle(), &state)
}

pub fn reconcile_rpc(app: &tauri::AppHandle, state: &AppState) -> AppResult<RpcStatus> {
    let settings = state
        .settings
        .read()
        .map_err(|_| AppError::State("settings unavailable".into()))?
        .snapshot();

    let mut rpc = state
        .rpc
        .lock()
        .map_err(|_| AppError::State("RPC service unavailable".into()))?;

    if !settings.rpc.enabled {
        if let Ok(mut active_rpc) = state.active_rpc_tab_id.lock() {
            *active_rpc = None;
        }
        let status = if rpc.status().state != "disabled" {
            rpc.clear(&settings.rpc)?
        } else {
            RpcStatus::disabled()
        };
        let _ = app.emit(events::RPC_STATUS, &status);
        return Ok(status);
    }

    let session = state
        .tabs
        .lock()
        .map_err(|_| AppError::State("tabs unavailable".into()))?
        .snapshot();
    let media = state
        .media_by_tab
        .lock()
        .map_err(|_| AppError::State("media state unavailable".into()))?;
    let current_primary = state
        .active_rpc_tab_id
        .lock()
        .ok()
        .and_then(|g| g.clone());

    let candidates: Vec<crate::rpc::model::RpcTabCandidate<'_>> = session
        .tabs
        .iter()
        .filter_map(|tab| {
            let m = media.get(&tab.id)?;
            let snapshot = m.last_player.as_ref()?;
            Some(crate::rpc::model::RpcTabCandidate {
                tab_id: &tab.id,
                is_active: tab.id == session.active_tab_id,
                eligible: !tab.sleeping,
                last_updated_ms: m.last_updated_ms,
                snapshot,
            })
        })
        .collect();

    let selected = crate::rpc::model::select_rpc_candidate(
        &candidates,
        settings.rpc.tab_mode,
        current_primary.as_deref(),
    );

    let (status, chosen_id) = match selected {
        Some(candidate) => {
            let app_id = app_id_for(&settings.rpc, candidate.snapshot.is_music());
            match build_activity(candidate.snapshot, &settings.rpc, &settings.general.language) {
                Some(activity) => (
                    rpc.update(&activity, &settings.rpc, app_id)?,
                    Some(candidate.tab_id.to_string()),
                ),
                None => (rpc.clear(&settings.rpc)?, None),
            }
        }
        None => (rpc.clear(&settings.rpc)?, None),
    };

    if let Ok(mut active_rpc) = state.active_rpc_tab_id.lock() {
        *active_rpc = chosen_id.clone();
    }
    let _ = app.emit("rpc://active-tab", chosen_id);
    let _ = app.emit(events::RPC_STATUS, &status);
    Ok(status)
}

/// Feeds the watch tracker and persists an entry once a video crosses the
/// minimum watch time. Storing is detached so the player callback returns fast.
fn record_history(
    state: &AppState,
    settings: &AppSettings,
    tab_id: &str,
    profile_id: &str,
    snapshot: &PlayerSnapshot,
) -> AppResult<()> {
    let mut media = state
        .media_by_tab
        .lock()
        .map_err(|_| AppError::State("watch tracker unavailable".into()))?;
    let tracker = &mut media.entry(tab_id.to_string()).or_default().tracker;

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
    let profile_id = profile_id.to_string();

    tauri::async_runtime::spawn(async move {
        if !record.is_new_session {
            let input = WatchEventInput {
                video_id: record.video_id,
                title: record.title,
                channel: record.channel,
                duration_secs: record.duration_secs,
                thumbnail_url: None,
                watched_at: None,
                position_secs: Some(record.position_secs),
                watched_secs: Some(record.watched_secs),
                session_key: Some(record.session_key),
                profile_id,
            };
            let _ = repository.update_progress(input).await;
            return;
        }

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
            position_secs: Some(record.position_secs),
            watched_secs: Some(record.watched_secs),
            session_key: Some(record.session_key),
            profile_id,
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
