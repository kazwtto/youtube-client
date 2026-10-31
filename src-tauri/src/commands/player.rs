use tauri::{Emitter, Manager, State};

use crate::core::error::{AppError, AppResult};
use crate::core::events;
use crate::core::state::AppState;
use crate::player::PlayerSnapshot;
use crate::rpc::model::{build_activity, RpcStatus};

/// Receives player state from the observer injected into YouTube, forwards it to
/// the UI, and updates the Discord presence.
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

    let mut rpc = state
        .rpc
        .lock()
        .map_err(|_| AppError::State("RPC service unavailable".into()))?;

    let status = match build_activity(&snapshot, &settings.rpc, &settings.general.language) {
        Some(activity) => rpc.update(&activity, &settings.rpc)?,
        None => rpc.clear(&settings.rpc)?,
    };

    let _ = window.app_handle().emit(events::RPC_STATUS, &status);
    Ok(status)
}
