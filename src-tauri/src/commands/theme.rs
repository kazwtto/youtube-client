use tauri::{Emitter, Manager, State};

use crate::core::error::{AppError, AppResult};
use crate::core::events;
use crate::core::state::AppState;
use crate::theme::model::{ResolvedTheme, ThemeSettings, ThemeSummary};
use crate::theme::registry;
use crate::theme::service::ThemeService;

#[tauri::command]
pub fn theme_list() -> Vec<ThemeSummary> {
    registry::summaries()
}

#[tauri::command]
pub fn theme_get(window: tauri::Window, state: State<'_, AppState>) -> AppResult<ResolvedTheme> {
    let settings = state
        .settings
        .read()
        .map_err(|_| AppError::State("settings unavailable".into()))?
        .snapshot();

    ThemeService::resolve(&settings.theme, system_dark(&window))
}

#[tauri::command]
pub fn theme_update(
    window: tauri::Window,
    state: State<'_, AppState>,
    theme: ThemeSettings,
) -> AppResult<ResolvedTheme> {
    let resolved = ThemeService::resolve(&theme, system_dark(&window))?;

    ThemeService::apply_to_window(&window, &resolved)?;
    let _ = ThemeService::apply_to_youtube(&window, &resolved);

    {
        let mut store = state
            .settings
            .write()
            .map_err(|_| AppError::State("settings unavailable".into()))?;
        let mut settings = store.snapshot();
        settings.theme = theme;
        store.replace(settings)?;
    }

    let _ = window.app_handle().emit(events::THEME_CHANGED, &resolved);

    Ok(resolved)
}

fn system_dark(window: &tauri::Window) -> bool {
    matches!(window.theme(), Ok(tauri::Theme::Dark))
}
