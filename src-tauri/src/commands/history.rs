use tauri::State;

use crate::core::error::AppResult;
use crate::core::state::AppState;
use crate::history::{HistoryEntry, HistoryQuery};

#[tauri::command]
pub async fn history_list(
    state: State<'_, AppState>,
    query: HistoryQuery,
) -> AppResult<Vec<HistoryEntry>> {
    state.history.list(query).await
}

#[tauri::command]
pub async fn history_clear(state: State<'_, AppState>) -> AppResult<()> {
    state.history.clear().await
}

#[tauri::command]
pub async fn history_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.history.delete(&id).await
}
