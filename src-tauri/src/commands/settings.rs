use tauri::{Emitter, Manager, State};

use crate::core::error::{AppError, AppResult};
use crate::core::events;
use crate::core::state::AppState;
use crate::settings::AppSettings;
use crate::theme::service::ThemeService;

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> AppResult<AppSettings> {
    let settings = state
        .settings
        .read()
        .map_err(|_| AppError::State("settings unavailable".into()))?
        .snapshot();

    Ok(settings)
}

#[tauri::command]
pub fn settings_update(
    window: tauri::Window,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    let next = {
        let mut store = state
            .settings
            .write()
            .map_err(|_| AppError::State("settings unavailable".into()))?;

        // Window geometry is owned by the window event handler, never by the
        // settings form. Preserve the value the app has already remembered,
        // otherwise an auto-save made after a resize could roll it back.
        let mut incoming = settings;
        incoming.window = store.snapshot().window;
        store.replace(incoming)?
    };

    let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
    if let Ok(resolved) = ThemeService::resolve(&next.theme, system_dark) {
        let _ = ThemeService::apply_to_window(&window, &resolved);
        let _ = ThemeService::apply_to_youtube(&window, &resolved);
        let _ = window.app_handle().emit(events::THEME_CHANGED, &resolved);
    }

    let _ = window.app_handle().emit(events::SETTINGS_CHANGED, &next);

    // Synchronize Discord RPC immediately with the updated settings
    if let Ok(mut rpc) = state.rpc.lock() {
        if !next.rpc.enabled {
            let _ = rpc.clear(&next.rpc);
        } else if let Ok(last) = state.last_player.lock() {
            if let Some(snapshot) = last.as_ref() {
                let app_id = crate::rpc::model::app_id_for(&next.rpc, snapshot.is_music());
                if let Some(activity) =
                    crate::rpc::model::build_activity(snapshot, &next.rpc, &next.general.language)
                {
                    let _ = rpc.update(&activity, &next.rpc, app_id);
                } else {
                    let _ = rpc.clear(&next.rpc);
                }
            }
        }
    }

    Ok(next)
}
