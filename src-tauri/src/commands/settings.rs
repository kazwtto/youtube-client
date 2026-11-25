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
pub async fn settings_update(
    window: tauri::Window,
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    let (previous_language, previous_masthead, next) = {
        let mut store = state
            .settings
            .write()
            .map_err(|_| AppError::State("settings unavailable".into()))?;

        // Window geometry is owned by the window event handler, never by the
        // settings form. Preserve the value the app has already remembered,
        // otherwise an auto-save made after a resize could roll it back.
        let mut incoming = settings;
        let current = store.snapshot();
        incoming.window = current.window;
        incoming.general.last_youtube_url = current.general.last_youtube_url;
        let previous_language = current.general.language;
        let previous_masthead = current.general.integrate_masthead;
        (
            previous_language,
            previous_masthead,
            store.replace(incoming)?,
        )
    };

    if previous_language != next.general.language {
        let _ = crate::window::tray::update_menu(&window.app_handle(), &next.general.language);
    }

    if previous_masthead != next.general.integrate_masthead {
        let _ = crate::commands::window::set_masthead_integrated(
            window.clone(),
            next.general.integrate_masthead,
        );
    }

    let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
    if let Ok(resolved) = ThemeService::resolve(&next.theme, system_dark) {
        let _ = ThemeService::apply_to_window(&window, &resolved);
        let _ = ThemeService::apply_to_youtube(&window, &resolved);
        let _ = window.app_handle().emit(events::THEME_CHANGED, &resolved);
    }

    state
        .sidebar_width
        .store(next.tabs.sidebar_width.clamp(148, 220), std::sync::atomic::Ordering::SeqCst);
    state
        .sidebar_expanded
        .store(next.tabs.sidebar_expanded, std::sync::atomic::Ordering::SeqCst);

    if !next.tabs.enabled || next.tabs.layout != crate::settings::model::TabLayout::SidebarHover {
        state.sidebar_peek.store(false, std::sync::atomic::Ordering::SeqCst);
    }
    if !next.tabs.enabled || next.tabs.layout != crate::settings::model::TabLayout::Floating {
        state.dock_peek.store(false, std::sync::atomic::Ordering::SeqCst);
    }

    let peek_mode = if !next.tabs.enabled {
        "none"
    } else {
        match next.tabs.layout {
            crate::settings::model::TabLayout::SidebarHover => "sidebarHover",
            crate::settings::model::TabLayout::Floating => "floating",
            _ => "none",
        }
    };
    let peek_js = format!("window.__ytdesktopPeekMode = \"{peek_mode}\";");
    if let Ok(manager) = state.tabs.lock() {
        for tab in manager.snapshot().tabs {
            if !tab.sleeping {
                if let Some(wv) = window.get_webview(&tab.webview_label) {
                    let _ = wv.eval(&peek_js);
                }
            }
        }
    }

    let _ = crate::window::layout::sync_tab_dock_webview(&window, &state.paths.webview_data_dir);
    let _ = crate::window::layout::layout_webviews(&window);
    let _ = window.app_handle().emit(events::SETTINGS_CHANGED, &next);

    // Synchronize Discord RPC immediately with the updated settings
    let _ = crate::commands::player::reconcile_rpc(window.app_handle(), &state);

    Ok(next)
}
