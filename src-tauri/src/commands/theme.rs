use tauri::State;

use crate::core::error::{AppError, AppResult};
use crate::core::state::AppState;
use crate::theme::model::{ResolvedTheme, ThemeSummary};
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

fn system_dark(window: &tauri::Window) -> bool {
    matches!(window.theme(), Ok(tauri::Theme::Dark))
}
