use tauri::State;

use crate::core::error::AppResult;
use crate::core::state::AppState;
use crate::history::{HistoryEntry, HistoryQuery};

fn active_profile_id(state: &AppState) -> String {
    state
        .tabs
        .lock()
        .ok()
        .map(|manager| manager.active_history_scope().to_string())
        .unwrap_or_else(|| crate::tabs::DEFAULT_HISTORY_SCOPE.to_string())
}

#[tauri::command]
pub async fn history_list(
    state: State<'_, AppState>,
    mut query: HistoryQuery,
) -> AppResult<Vec<HistoryEntry>> {
    if query.profile_id.is_none() {
        query.profile_id = Some(active_profile_id(&state));
    }
    state.history.list(query).await
}

#[tauri::command]
pub async fn history_resume_position(
    webview: tauri::Webview,
    state: State<'_, AppState>,
    video_id: String,
) -> AppResult<Option<f64>> {
    let valid = !video_id.is_empty()
        && video_id.len() <= 32
        && video_id.chars().all(|character| {
            character.is_ascii_alphanumeric() || character == '-' || character == '_'
        });
    if !valid {
        return Err(crate::core::error::AppError::Validation(format!(
            "invalid video id: {video_id}"
        )));
    }

    let profile_id = state
        .tabs
        .lock()
        .ok()
        .and_then(|manager| {
            manager
                .tab_by_label(webview.label())
                .map(|t| t.history_scope().to_string())
        })
        .unwrap_or_else(|| active_profile_id(&state));

    state.history.resume_position(&video_id, &profile_id).await
}

#[tauri::command]
pub async fn history_clear(
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> AppResult<()> {
    let resolved = profile_id.unwrap_or_else(|| active_profile_id(&state));
    state.history.clear(Some(&resolved)).await?;

    if resolved == "all" {
        let thumbnails_dir = state.paths.thumbnails_dir.clone();
        let _ = tokio::task::spawn_blocking(move || {
            if let Ok(entries) = std::fs::read_dir(thumbnails_dir) {
                for entry in entries.flatten() {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        })
        .await;
    }

    Ok(())
}

#[tauri::command]
pub async fn history_delete(
    state: State<'_, AppState>,
    id: String,
    profile_id: Option<String>,
) -> AppResult<()> {
    let resolved = profile_id.unwrap_or_else(|| active_profile_id(&state));
    state.history.delete(&id, Some(&resolved)).await?;

    Ok(())
}
