use tauri::{Emitter, Manager, State};

use crate::core::error::{AppError, AppResult};
use crate::core::events;
use crate::core::state::AppState;
use crate::player::PlayerSnapshot;
use crate::rpc::model::{app_id_for, build_activity, RpcStatus};

#[tauri::command]
pub fn rpc_status(state: State<'_, AppState>) -> AppResult<RpcStatus> {
    let rpc = state
        .rpc
        .lock()
        .map_err(|_| AppError::State("RPC service unavailable".into()))?;

    Ok(rpc.status())
}

#[tauri::command]
pub fn rpc_update(
    window: tauri::Window,
    state: State<'_, AppState>,
    snapshot: PlayerSnapshot,
) -> AppResult<RpcStatus> {
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
        Some(activity) => {
            let app_id = app_id_for(&settings.rpc, snapshot.is_music());
            rpc.update(&activity, &settings.rpc, app_id)?
        }
        None => rpc.clear(&settings.rpc)?,
    };

    let _ = window.app_handle().emit(events::RPC_STATUS, &status);
    Ok(status)
}
