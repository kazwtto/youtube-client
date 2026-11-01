use tauri::State;

use crate::core::error::{AppError, AppResult};
use crate::core::state::AppState;
use crate::rpc::model::RpcStatus;

#[tauri::command]
pub fn rpc_status(state: State<'_, AppState>) -> AppResult<RpcStatus> {
    let rpc = state
        .rpc
        .lock()
        .map_err(|_| AppError::State("RPC service unavailable".into()))?;

    Ok(rpc.status())
}
