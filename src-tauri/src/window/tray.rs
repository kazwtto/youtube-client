use std::time::Duration;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, Runtime, Window};

use crate::core::error::{AppError, AppResult};
use crate::core::state::AppState;

use super::layout::MAIN_WINDOW_LABEL;

pub const TRAY_ID: &str = "main-tray";

pub fn setup(app: &App) -> AppResult<()> {
    let language = app
        .state::<AppState>()
        .settings
        .read()
        .map(|settings| settings.snapshot().general.language)
        .unwrap_or_else(|_| "en".to_string());
    let menu = build_menu(app, &language)?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| AppError::Other("default app icon is missing".into()))?;

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip("YouTube Client")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => restore(app),
            "quit" => quit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                restore(tray.app_handle());
            }
        })
        .build(app)?;

    tray.set_visible(false)?;
    Ok(())
}

pub fn update_menu(app: &AppHandle, language: &str) -> AppResult<()> {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return Ok(());
    };

    tray.set_menu(Some(build_menu(app, language)?))?;
    Ok(())
}

pub fn defer_minimize_to_tray(window: &Window) {
    let enabled = window
        .app_handle()
        .try_state::<AppState>()
        .and_then(|state| {
            state
                .settings
                .read()
                .ok()
                .map(|settings| settings.snapshot().general.minimize_to_tray)
        })
        .unwrap_or(false);
    if !enabled {
        return;
    }

    let window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(320)).await;
        if !window.is_minimized().unwrap_or(false) {
            return;
        }

        let Some(state) = window.app_handle().try_state::<AppState>() else {
            return;
        };
        let enabled = state
            .settings
            .read()
            .map(|settings| settings.snapshot().general.minimize_to_tray)
            .unwrap_or(false);
        if !enabled {
            return;
        }

        let Some(tray) = window.app_handle().tray_by_id(TRAY_ID) else {
            return;
        };
        if tray.set_visible(true).is_ok() {
            let _ = window.hide();
        }
    });
}

fn restore(app: &AppHandle) {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(false);
    }

    if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn quit(app: &AppHandle) {
    if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
        let _ = window.close();
    }
    app.exit(0);
}

fn build_menu<R: Runtime, M: Manager<R>>(manager: &M, language: &str) -> tauri::Result<Menu<R>> {
    let (open_label, quit_label) = if language.to_lowercase().starts_with("pt") {
        ("Abrir", "Sair")
    } else {
        ("Open", "Quit")
    };

    let open = MenuItem::with_id(manager, "open", open_label, true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(manager)?;
    let quit = MenuItem::with_id(manager, "quit", quit_label, true, None::<&str>)?;
    Menu::with_items(manager, &[&open, &separator, &quit])
}
