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
    state.history.clear().await?;

    let thumbnails_dir = state.paths.thumbnails_dir.clone();
    let _ = tokio::task::spawn_blocking(move || {
        if let Ok(entries) = std::fs::read_dir(thumbnails_dir) {
            for entry in entries.flatten() {
                let _ = std::fs::remove_file(entry.path());
            }
        }
    })
    .await;

    Ok(())
}

#[tauri::command]
pub async fn history_delete(state: State<'_, AppState>, id: String) -> AppResult<()> {
    state.history.delete(&id).await?;

    let thumb_file = state.paths.thumbnails_dir.join(format!("{}.jpg", id));
    let _ = tokio::task::spawn_blocking(move || {
        if thumb_file.exists() {
            let _ = std::fs::remove_file(thumb_file);
        }
    })
    .await;

    Ok(())
}
