use std::collections::BTreeSet;
use std::path::Path;

use tauri::{Emitter, Manager, State};

use crate::core::error::{AppError, AppResult};
use crate::core::events;
use crate::core::state::AppState;
use crate::extensions::ExtensionSummary;

#[tauri::command]
pub fn extensions_list(state: State<'_, AppState>) -> AppResult<Vec<ExtensionSummary>> {
    let disabled = disabled_set(&state)?;
    state.extensions.list(&disabled)
}

#[tauri::command]
pub fn extensions_install(
    window: tauri::Window,
    state: State<'_, AppState>,
    source: String,
) -> AppResult<ExtensionSummary> {
    let summary = state.extensions.install(Path::new(&source))?;
    let _ = window.app_handle().emit(events::EXTENSIONS_CHANGED, ());
    Ok(summary)
}

#[tauri::command]
pub fn extensions_uninstall(
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

    let _ = window.app_handle().emit(events::EXTENSIONS_CHANGED, ());
    Ok(())
}

#[tauri::command]
pub fn extensions_set_enabled(
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

    let disabled = disabled_set(&state)?;
    let list = state.extensions.list(&disabled)?;
    let _ = window.app_handle().emit(events::EXTENSIONS_CHANGED, ());
    Ok(list)
}

fn disabled_set(state: &AppState) -> AppResult<BTreeSet<String>> {
    let settings = state
        .settings
        .read()
        .map_err(|_| AppError::State("settings unavailable".into()))?
        .snapshot();

    Ok(settings.extensions.disabled)
}
