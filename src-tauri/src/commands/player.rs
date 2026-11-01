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

    tauri::async_runtime::spawn(async move {
        let input = WatchEventInput {
            video_id: record.video_id,
            title: record.title,
            channel: record.channel,
            duration_secs: record.duration_secs,
            thumbnail_url: if keep_thumbnails {
                record.thumbnail_url
            } else {
                None
            },
            watched_at: None,
        };

        let _ = repository.record(input).await;
    });

    Ok(())
}
