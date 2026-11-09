use std::collections::BTreeSet;
use std::path::Path;
use std::sync::atomic::Ordering;

use tauri::{Emitter, Manager, State};

use crate::core::error::{AppError, AppResult};
use crate::core::events;
use crate::core::state::AppState;
use crate::extensions::{apply_runtime, ExtensionSummary};
use crate::window::layout::reload_youtube;

#[tauri::command]
pub fn extensions_list(state: State<'_, AppState>) -> AppResult<Vec<ExtensionSummary>> {
    let disabled = {
        let settings = state
            .settings
            .read()
            .map_err(|_| AppError::State("settings unavailable".into()))?
            .snapshot();
        settings.extensions.disabled
    };

    state.extensions.list(&disabled)
}

#[tauri::command]
pub async fn extensions_refresh(
    window: tauri::Window,
    state: State<'_, AppState>,
) -> AppResult<Vec<ExtensionSummary>> {
    let folder = state
        .settings
        .read()
        .map_err(|_| AppError::State("settings unavailable".into()))?
        .snapshot()
        .extensions
        .custom_folder;

    if let Some(folder) = folder.filter(|folder| folder.is_dir()) {
        let _ = state.extensions.install(&folder);
    }

    refresh(&window, &state).await?;
    state.extensions.list(&disabled_set(&state)?)
}

#[tauri::command]
pub async fn extensions_install(
    window: tauri::Window,
    state: State<'_, AppState>,
    source: String,
) -> AppResult<Vec<ExtensionSummary>> {
    let source_path = Path::new(&source);
    let summaries = state.extensions.install(source_path)?;

    if source_path.is_dir() {
        if let Ok(mut store) = state.settings.write() {
            let mut settings = store.snapshot();
            settings.extensions.custom_folder = Some(source_path.to_path_buf());
            let _ = store.replace(settings);
        }
    } else if let Some(parent) = source_path.parent() {
        if parent.is_dir() && parent != Path::new("") {
            if let Ok(mut store) = state.settings.write() {
                let mut settings = store.snapshot();
                if settings.extensions.custom_folder.is_none() {
                    settings.extensions.custom_folder = Some(parent.to_path_buf());
                    let _ = store.replace(settings);
                }
            }
        }
    }

    refresh(&window, &state).await?;
    Ok(summaries)
}

#[tauri::command]
pub async fn extensions_uninstall(
    window: tauri::Window,
    state: State<'_, AppState>,
    id: String,
) -> AppResult<()> {
    state.extensions.uninstall(&id)?;

    {
        let mut store = state
            .settings
            .write()
            .map_err(|_| AppError::State("settings unavailable".into()))?;
        let mut settings = store.snapshot();
        if settings.extensions.disabled.remove(&id) {
            store.replace(settings)?;
        }
    }

    refresh(&window, &state).await?;
    Ok(())
}

#[tauri::command]
pub async fn extensions_set_enabled(
    window: tauri::Window,
    state: State<'_, AppState>,
    id: String,
    enabled: bool,
) -> AppResult<Vec<ExtensionSummary>> {
    {
        let mut store = state
            .settings
            .write()
            .map_err(|_| AppError::State("settings unavailable".into()))?;
        let mut settings = store.snapshot();

        if enabled {
            settings.extensions.disabled.remove(&id);
        } else {
            settings.extensions.disabled.insert(id.clone());
        }

        store.replace(settings)?;
    }

    refresh(&window, &state).await?;

    let disabled = disabled_set(&state)?;
    state.extensions.list(&disabled)
}

/// Applies the enabled extensions to the WebView2 profile and rebuilds the
/// YouTube webview when the profile changed.
async fn refresh(window: &tauri::Window, state: &AppState) -> AppResult<()> {
    let disabled = state
        .settings
        .read()
        .map(|store| store.snapshot().extensions.disabled)
        .unwrap_or_default();

    let list = state.extensions.list(&disabled)?;
    let reload_result = if apply_runtime(window, &list) {
        let visible = state.youtube_visible.load(Ordering::SeqCst);
        reload_youtube(window, &state.paths.webview_data_dir, visible).await
    } else {
        Ok(())
    };

    let _ = window.app_handle().emit(events::EXTENSIONS_CHANGED, ());
    reload_result?;
    Ok(())
}

fn disabled_set(state: &AppState) -> AppResult<BTreeSet<String>> {
    let settings = state
        .settings
        .read()
        .map_err(|_| AppError::State("settings unavailable".into()))?
        .snapshot();

    Ok(settings.extensions.disabled)
}
