use std::collections::HashSet;
use std::sync::atomic::Ordering;
use std::time::Duration;

use tauri::{Emitter, Manager, State, Window};

use crate::commands::window::YoutubeNavState;
use crate::core::error::{AppError, AppResult};
use crate::core::state::AppState;
use crate::tabs::{CloseTabOutcome, TabSessionSnapshot, TabState};
use crate::theme::model::ThemeSettings;
use crate::theme::service::ThemeService;
use crate::window::layout::{
    bring_webview_to_front, create_tab_webview, layout_active_youtube_only, layout_webviews,
    set_webview_muted, sync_youtube_webview_bounds,
};

fn resolved_theme(window: &Window, state: &AppState) -> Option<crate::theme::model::ResolvedTheme> {
    let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
    let theme_settings = state
        .settings
        .read()
        .ok()
        .map(|s| s.snapshot().theme)
        .unwrap_or_default();
    ThemeService::resolve(&theme_settings, system_dark)
        .or_else(|_| ThemeService::resolve(&ThemeSettings::default(), system_dark))
        .ok()
}

fn emit_tabs_snapshot(window: &Window, snapshot: &TabSessionSnapshot) {
    let _ = window.app_handle().emit("tabs://updated", snapshot);
}

fn sync_active_tab_ui(window: &Window, state: &AppState, tab: &TabState) {
    let app = window.app_handle();
    let _ = app.emit(
        "youtube://nav-state",
        YoutubeNavState {
            can_go_back: tab.can_go_back,
            can_go_forward: tab.can_go_forward,
        },
    );
    if let Some(webview) = window.get_webview(&tab.webview_label) {
        let _ = webview.eval(
            "if (window.__ytdesktopRequestAuthSnapshot) window.__ytdesktopRequestAuthSnapshot(); if (window.__ytdesktopReportNavState) window.__ytdesktopReportNavState();",
        );
    }
    if let Ok(media) = state.media_by_tab.lock() {
        if let Some(player) = media.get(&tab.id).and_then(|m| m.last_player.as_ref()) {
            let _ = app.emit(crate::core::events::PLAYER_UPDATE, player);
        }
    }
}

async fn ensure_tab_webview(window: &Window, state: &AppState, tab: &TabState) -> AppResult<()> {
    if tab.needs_reload {
        if let Ok(mut painted) = state.painted_webviews.lock() {
            painted.remove(&tab.webview_label);
        }
        if let Some(existing) = window.get_webview(&tab.webview_label) {
            let _ = existing.close();
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
    }
    if window.get_webview(&tab.webview_label).is_none() {
        let theme = resolved_theme(window, state);
        let mut last_error = None;
        for attempt in 0..8 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(120)).await;
            }
            match create_tab_webview(window, tab, theme.as_ref()) {
                Ok(()) => {
                    last_error = None;
                    break;
                }
                Err(error) => last_error = Some(error),
            }
        }
        if let Some(error) = last_error {
            return Err(error);
        }
        if let Ok(mut manager) = state.tabs.lock() {
            if let Some(entry) = manager.tab_by_id_mut(&tab.id) {
                entry.sleeping = false;
                entry.needs_reload = false;
                let _ = manager.save();
            }
        }
    }
    Ok(())
}

fn sync_active_visibility(window: &Window, state: &AppState, label: &str) {
    if let Some(wv) = window.get_webview(label) {
        if state.youtube_visible.load(Ordering::SeqCst) {
            let _ = wv.show();
        } else {
            let _ = wv.hide();
        }
    }
}

fn schedule_loading_safety_timeout(window: &Window, target_label: String) {
    let app = window.app_handle().clone();
    let main_window = window.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(5)).await;
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        let still_waiting = state
            .loading_target_label
            .lock()
            .map(|mut guard| {
                if guard.as_deref() == Some(target_label.as_str()) {
                    *guard = None;
                    true
                } else {
                    false
                }
            })
            .unwrap_or(false);
        if still_waiting && state.youtube_loading.swap(false, Ordering::SeqCst) {
            state.youtube_ready.store(true, Ordering::SeqCst);
            let _ = layout_webviews(&main_window);
            let _ = app.emit(crate::core::events::YOUTUBE_LOADING, false);
        }
    });
}

async fn switch_active_surface(
    window: &Window,
    state: &AppState,
    prev_label: Option<String>,
    target: &TabState,
) -> AppResult<()> {
    let yt_visible = state.youtube_visible.load(Ordering::SeqCst);
    let already_ready = !target.needs_reload
        && window.get_webview(&target.webview_label).is_some()
        && state
            .painted_webviews
            .lock()
            .map(|set| set.contains(&target.webview_label))
            .unwrap_or(false);

    state.sidebar_peek.store(false, Ordering::SeqCst);
    let _ = window.app_handle().emit("tabs://sidebar-peek", false);

    if already_ready {
        if let Ok(mut guard) = state.loading_target_label.lock() {
            *guard = None;
        }
        if state.youtube_loading.swap(false, Ordering::SeqCst) {
            state.youtube_ready.store(true, Ordering::SeqCst);
            let _ = window
                .app_handle()
                .emit(crate::core::events::YOUTUBE_LOADING, false);
        }
        if yt_visible {
            let motion_enabled = state
                .settings
                .read()
                .map(|s| s.snapshot().theme.motion)
                .unwrap_or(true);
            let prev_lbl_opt = prev_label
                .as_deref()
                .filter(|l| *l != target.webview_label.as_str())
                .map(ToOwned::to_owned);
            let slide_dir: i32 = if let Some(ref prev_lbl) = prev_lbl_opt {
                state
                    .tabs
                    .lock()
                    .ok()
                    .map(|m| {
                        let tabs = m.snapshot().tabs;
                        let prev_idx = tabs.iter().position(|t| &t.webview_label == prev_lbl);
                        let next_idx = tabs
                            .iter()
                            .position(|t| t.webview_label == target.webview_label);
                        match (prev_idx, next_idx) {
                            (Some(p), Some(n)) if n < p => -1,
                            _ => 1,
                        }
                    })
                    .unwrap_or(1)
            } else {
                0
            };

            let transition_gen = state.tab_transition_gen.fetch_add(1, Ordering::SeqCst) + 1;
            let tab_layout = state
                .settings
                .read()
                .map(|s| s.snapshot().tabs.layout)
                .unwrap_or(crate::settings::model::TabLayout::Command);
            let is_vertical_tabs = matches!(
                tab_layout,
                crate::settings::model::TabLayout::Sidebar
                    | crate::settings::model::TabLayout::SidebarHover
                    | crate::settings::model::TabLayout::Command
            );
            let keep_dock_on_top = state
                .settings
                .read()
                .map(|s| {
                    let tabs = s.snapshot().tabs;
                    tabs.enabled && tabs.layout == crate::settings::model::TabLayout::Floating
                })
                .unwrap_or(false)
                && state.dock_peek.load(Ordering::SeqCst)
                && !state.ui_elevated.load(Ordering::SeqCst)
                && !state.youtube_loading.load(Ordering::SeqCst);

            if let Some(next_wv) = window.get_webview(&target.webview_label) {
                let _ = sync_youtube_webview_bounds(window, &next_wv);
                let solid_bg = resolved_theme(window, state)
                    .and_then(|t| t.tokens.get("--color-bg-solid").cloned())
                    .unwrap_or_else(|| "#0f0f0f".to_string());

                if motion_enabled && slide_dir != 0 {
                    let offset = slide_dir * 26;
                    let axis = if is_vertical_tabs { "Y" } else { "X" };
                    let overflow_prop = if is_vertical_tabs { "overflowY" } else { "overflowX" };
                    let prep_js = format!(
                        "(function(){{var r=document.documentElement;var el=document.querySelector('ytd-app')||document.body;if(!r||!el)return;el.getAnimations().forEach(function(a){{a.cancel();}});r.dataset.ytdSwitching='1';r.style.backgroundColor='{solid_bg}';r.style.{overflow_prop}='hidden';el.style.transform='translate{axis}({offset}px)';}})();"
                    );
                    let _ = next_wv.eval(&prep_js);
                    let _ = next_wv.show();
                    if let Some(ref prev_lbl) = prev_lbl_opt {
                        let _ = bring_webview_to_front(window, prev_lbl);
                    }
                    if keep_dock_on_top {
                        let _ = bring_webview_to_front(window, crate::window::layout::TAB_DOCK_WEBVIEW_LABEL);
                    }
                    tokio::time::sleep(Duration::from_millis(42)).await;
                    if state.tab_transition_gen.load(Ordering::SeqCst) != transition_gen {
                        let _ = next_wv.eval(
                            "(function(){var r=document.documentElement;var el=document.querySelector('ytd-app')||document.body;if(el){el.style.transform='';}if(r){delete r.dataset.ytdSwitching;r.style.backgroundColor='';r.style.overflowX='';r.style.overflowY='';}})();",
                        );
                        let active_now = crate::window::layout::active_youtube_label(window.app_handle());
                        if active_now != target.webview_label {
                            let _ = next_wv.hide();
                        }
                        if let Some(ref prev_lbl) = prev_lbl_opt {
                            if active_now != *prev_lbl {
                                if let Some(prev_wv) = window.get_webview(prev_lbl) {
                                    let _ = prev_wv.hide();
                                }
                            }
                        }
                        return Ok(());
                    }
                    if crate::window::layout::active_youtube_label(window.app_handle()) != target.webview_label {
                        let _ = next_wv.hide();
                        return Ok(());
                    }
                    let _ = bring_webview_to_front(window, &target.webview_label);
                    if keep_dock_on_top {
                        let _ = bring_webview_to_front(window, crate::window::layout::TAB_DOCK_WEBVIEW_LABEL);
                    }
                    let _ = next_wv.set_focus();
                    let play_js = format!(
                        "(function(){{var r=document.documentElement;var el=document.querySelector('ytd-app')||document.body;if(!r||!el)return;var anim=el.animate([{{transform:'translate{axis}({offset}px)',filter:'brightness(0.84)'}},{{transform:'translate{axis}(0px)',filter:'brightness(1)'}}],{{duration:200,easing:'cubic-bezier(0.22,1,0.36,1)'}});el.style.transform='';anim.onfinish=anim.oncancel=function(){{delete r.dataset.ytdSwitching;r.style.backgroundColor='';r.style.overflowX='';r.style.overflowY='';}};}})();"
                    );
                    let _ = next_wv.eval(&play_js);
                    if let Some(prev_lbl) = prev_lbl_opt {
                        let win = window.clone();
                        let app = window.app_handle().clone();
                        tauri::async_runtime::spawn(async move {
                            tokio::time::sleep(Duration::from_millis(40)).await;
                            if crate::window::layout::active_youtube_label(&app) != prev_lbl {
                                if let Some(prev_wv) = win.get_webview(&prev_lbl) {
                                    let _ = prev_wv.hide();
                                }
                            }
                        });
                    }
                } else {
                    let _ = next_wv.show();
                    let _ = bring_webview_to_front(window, &target.webview_label);
                    if keep_dock_on_top {
                        let _ = bring_webview_to_front(window, crate::window::layout::TAB_DOCK_WEBVIEW_LABEL);
                    }
                    let _ = next_wv.set_focus();
                    if let Some(prev_lbl) = prev_lbl_opt {
                        if let Some(prev_wv) = window.get_webview(&prev_lbl) {
                            let _ = prev_wv.hide();
                        }
                    }
                }
            }
            if keep_dock_on_top {
                let _ = bring_webview_to_front(window, crate::window::layout::TAB_DOCK_WEBVIEW_LABEL);
            }
        } else {
            if let Some(prev_lbl) = prev_label.as_deref() {
                if prev_lbl != target.webview_label.as_str() {
                    if let Some(prev_wv) = window.get_webview(prev_lbl) {
                        let _ = prev_wv.hide();
                    }
                }
            }
            let _ = layout_webviews(window);
        }
    } else {
        if yt_visible {
            if let Ok(mut guard) = state.loading_target_label.lock() {
                *guard = Some(target.webview_label.clone());
            }
            state.youtube_ready.store(false, Ordering::SeqCst);
            state.youtube_loading.store(true, Ordering::SeqCst);
            let _ = layout_webviews(window);
            let _ = window
                .app_handle()
                .emit(crate::core::events::YOUTUBE_LOADING, true);
            tokio::time::sleep(Duration::from_millis(16)).await;
        }
        if let Some(prev) = prev_label.as_deref().and_then(|l| window.get_webview(l)) {
            if prev_label.as_deref() != Some(target.webview_label.as_str()) {
                let _ = prev.hide();
            }
        }
        ensure_tab_webview(window, state, target).await?;
        sync_active_visibility(window, state, &target.webview_label);
        let _ = layout_webviews(window);
        if yt_visible {
            schedule_loading_safety_timeout(window, target.webview_label.clone());
        }
    }

    sync_active_tab_ui(window, state, target);
    if state.launcher_route_active.load(Ordering::SeqCst) {
        let _ = window.app_handle().emit("app://navigate", "home");
    }
    Ok(())
}

fn close_webview_and_clear(window: &Window, state: &AppState, label: &str) {
    if let Ok(mut painted) = state.painted_webviews.lock() {
        painted.remove(label);
    }
    if let Some(wv) = window.get_webview(label) {
        #[cfg(windows)]
        crate::window::webview_popups::unwatch_webview(&wv);
        let _ = wv.close();
    }
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockContextMenuEvent {
    pub tab_id: String,
    pub x: f64,
    pub y: f64,
}

#[tauri::command]
pub fn set_tab_dock_width(
    window: Window,
    state: State<'_, AppState>,
    width: f64,
) -> AppResult<()> {
    let clamped = (width.ceil() as u32).clamp(120, 2400);
    let prev = state.dock_width.swap(clamped, Ordering::SeqCst);
    if prev != clamped {
        let _ = layout_webviews(&window);
    }
    Ok(())
}

#[tauri::command]
pub fn tab_open_context_menu(
    window: Window,
    tab_id: String,
    x: f64,
    y: f64,
) -> AppResult<()> {
    let (dock_pos, _) = crate::window::layout::tab_dock_bounds(&window)?;
    let _ = window.app_handle().emit(
        "tabs://open-context-menu",
        DockContextMenuEvent {
            tab_id,
            x: dock_pos.x + x,
            y: dock_pos.y + y,
        },
    );
    Ok(())
}

#[tauri::command]
pub fn tabs_snapshot(state: State<'_, AppState>) -> AppResult<TabSessionSnapshot> {
    let manager = state
        .tabs
        .lock()
        .map_err(|_| AppError::State("tabs unavailable".into()))?;
    Ok(manager.snapshot())
}

#[tauri::command]
pub async fn tab_create(
    window: Window,
    state: State<'_, AppState>,
    isolated: Option<bool>,
    url: Option<String>,
    activate: Option<bool>,
) -> AppResult<TabSessionSnapshot> {
    let activate = activate.unwrap_or(true);
    let default_isolated = state
        .settings
        .read()
        .map(|s| s.snapshot().tabs.default_isolated)
        .unwrap_or(false);
    let isolated = isolated.unwrap_or(default_isolated);

    let prev_active_label = state
        .tabs
        .lock()
        .ok()
        .and_then(|m| m.active_tab().map(|t| t.webview_label.clone()));

    let (tab, snapshot) = {
        let mut manager = state
            .tabs
            .lock()
            .map_err(|_| AppError::State("tabs unavailable".into()))?;
        let tab = manager.create_tab(isolated, url, activate)?;
        (tab, manager.snapshot())
    };
    emit_tabs_snapshot(&window, &snapshot);

    if activate {
        switch_active_surface(&window, &state, prev_active_label, &tab).await?;
    }

    let _ = crate::commands::player::reconcile_rpc(window.app_handle(), &state);
    let latest = state
        .tabs
        .lock()
        .map_err(|_| AppError::State("tabs unavailable".into()))?
        .snapshot();
    Ok(latest)
}

#[tauri::command]
pub async fn tab_activate(
    window: Window,
    state: State<'_, AppState>,
    tab_id: String,
) -> AppResult<TabSessionSnapshot> {
    let prev_label = state
        .tabs
        .lock()
        .ok()
        .and_then(|m| m.active_tab().map(|t| t.webview_label.clone()));

    let (tab, snapshot) = {
        let mut manager = state
            .tabs
            .lock()
            .map_err(|_| AppError::State("tabs unavailable".into()))?;
        let tab = manager.activate_tab(&tab_id)?;
        (tab, manager.snapshot())
    };
    emit_tabs_snapshot(&window, &snapshot);

    switch_active_surface(&window, &state, prev_label, &tab).await?;

    let _ = crate::commands::player::reconcile_rpc(window.app_handle(), &state);
    let latest = state
        .tabs
        .lock()
        .map_err(|_| AppError::State("tabs unavailable".into()))?
        .snapshot();
    Ok(latest)
}

#[tauri::command]
pub async fn tab_close(
    window: Window,
    state: State<'_, AppState>,
    tab_id: String,
) -> AppResult<TabSessionSnapshot> {
    let (was_active_label, outcome, snapshot) = {
        let mut manager = state
            .tabs
            .lock()
            .map_err(|_| AppError::State("tabs unavailable".into()))?;
        let was_active_label = manager.active_tab().map(|t| t.webview_label.clone());
        let outcome = manager.close_tab(&tab_id)?;
        (was_active_label, outcome, manager.snapshot())
    };
    emit_tabs_snapshot(&window, &snapshot);

    match outcome {
        CloseTabOutcome::Closed {
            closed,
            next_active,
        } => {
            if let Ok(mut media) = state.media_by_tab.lock() {
                media.remove(&closed.id);
            }
            if let Ok(mut active_rpc) = state.active_rpc_tab_id.lock() {
                if active_rpc.as_deref() == Some(closed.id.as_str()) {
                    *active_rpc = None;
                }
            }
            let closed_was_active =
                was_active_label.as_deref() == Some(closed.webview_label.as_str());
            if closed_was_active {
                switch_active_surface(
                    &window,
                    &state,
                    Some(closed.webview_label.clone()),
                    &next_active,
                )
                .await?;
            }
            close_webview_and_clear(&window, &state, &closed.webview_label);
        }
        CloseTabOutcome::ResetSingle(tab) => {
            if let Ok(mut media) = state.media_by_tab.lock() {
                media.remove(&tab.id);
            }
            if let Some(wv) = window.get_webview(&tab.webview_label) {
                let _ = wv.eval("location.href = 'https://www.youtube.com';");
            }
            sync_active_tab_ui(&window, &state, &tab);
        }
    }

    let _ = crate::commands::player::reconcile_rpc(window.app_handle(), &state);
    let latest = state
        .tabs
        .lock()
        .map_err(|_| AppError::State("tabs unavailable".into()))?
        .snapshot();
    Ok(latest)
}

#[tauri::command]
pub async fn tab_close_others(
    window: Window,
    state: State<'_, AppState>,
    tab_id: String,
) -> AppResult<TabSessionSnapshot> {
    let prev_label = state
        .tabs
        .lock()
        .ok()
        .and_then(|m| m.active_tab().map(|t| t.webview_label.clone()));

    let (closed, active, snapshot) = {
        let mut manager = state
            .tabs
            .lock()
            .map_err(|_| AppError::State("tabs unavailable".into()))?;
        let (closed, active) = manager.close_other_tabs(&tab_id)?;
        (closed, active, manager.snapshot())
    };
    emit_tabs_snapshot(&window, &snapshot);

    switch_active_surface(&window, &state, prev_label, &active).await?;

    for item in closed {
        if let Ok(mut media) = state.media_by_tab.lock() {
            media.remove(&item.id);
        }
        close_webview_and_clear(&window, &state, &item.webview_label);
    }

    let _ = crate::commands::player::reconcile_rpc(window.app_handle(), &state);
    let latest = state
        .tabs
        .lock()
        .map_err(|_| AppError::State("tabs unavailable".into()))?
        .snapshot();
    Ok(latest)
}

#[tauri::command]
pub async fn tab_reopen_closed(
    window: Window,
    state: State<'_, AppState>,
) -> AppResult<TabSessionSnapshot> {
    let prev_label = state
        .tabs
        .lock()
        .ok()
        .and_then(|m| m.active_tab().map(|t| t.webview_label.clone()));

    let (reopened, snapshot) = {
        let mut manager = state
            .tabs
            .lock()
            .map_err(|_| AppError::State("tabs unavailable".into()))?;
        let reopened = manager.reopen_last_closed()?;
        (reopened, manager.snapshot())
    };
    emit_tabs_snapshot(&window, &snapshot);

    if let Some(tab) = reopened {
        switch_active_surface(&window, &state, prev_label, &tab).await?;
    }

    let _ = crate::commands::player::reconcile_rpc(window.app_handle(), &state);
    let latest = state
        .tabs
        .lock()
        .map_err(|_| AppError::State("tabs unavailable".into()))?
        .snapshot();
    Ok(latest)
}

#[tauri::command]
pub fn tab_reorder(
    window: Window,
    state: State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> AppResult<TabSessionSnapshot> {
    let snapshot = {
        let mut manager = state
            .tabs
            .lock()
            .map_err(|_| AppError::State("tabs unavailable".into()))?;
        manager.reorder_tabs(&ordered_ids)?;
        manager.snapshot()
    };
    emit_tabs_snapshot(&window, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub fn tab_set_pinned(
    window: Window,
    state: State<'_, AppState>,
    tab_id: String,
    pinned: bool,
) -> AppResult<TabSessionSnapshot> {
    let snapshot = {
        let mut manager = state
            .tabs
            .lock()
            .map_err(|_| AppError::State("tabs unavailable".into()))?;
        manager.set_pinned(&tab_id, pinned)?;
        manager.snapshot()
    };
    emit_tabs_snapshot(&window, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn tab_set_muted(
    window: Window,
    state: State<'_, AppState>,
    tab_id: String,
    muted: bool,
) -> AppResult<TabSessionSnapshot> {
    let (label, snapshot) = {
        let mut manager = state
            .tabs
            .lock()
            .map_err(|_| AppError::State("tabs unavailable".into()))?;
        let label = manager.set_muted(&tab_id, muted)?;
        (label, manager.snapshot())
    };
    let _ = set_webview_muted(&window, &label, muted);
    emit_tabs_snapshot(&window, &snapshot);
    Ok(snapshot)
}

#[tauri::command]
pub async fn tab_duplicate(
    window: Window,
    state: State<'_, AppState>,
    tab_id: String,
    isolated: Option<bool>,
) -> AppResult<TabSessionSnapshot> {
    let prev_active_label = state
        .tabs
        .lock()
        .ok()
        .and_then(|m| m.active_tab().map(|t| t.webview_label.clone()));

    let (tab, snapshot) = {
        let mut manager = state
            .tabs
            .lock()
            .map_err(|_| AppError::State("tabs unavailable".into()))?;
        let source = manager
            .tab_by_id(&tab_id)
            .ok_or_else(|| AppError::NotFound(format!("tab {tab_id}")))?
            .clone();
        let next_isolated = isolated.unwrap_or(source.isolated);
        let tab = manager.create_tab(next_isolated, Some(source.url), true)?;
        (tab, manager.snapshot())
    };
    emit_tabs_snapshot(&window, &snapshot);

    switch_active_surface(&window, &state, prev_active_label, &tab).await?;

    let _ = crate::commands::player::reconcile_rpc(window.app_handle(), &state);
    let latest = state
        .tabs
        .lock()
        .map_err(|_| AppError::State("tabs unavailable".into()))?
        .snapshot();
    Ok(latest)
}

#[tauri::command]
pub async fn tab_sleep(
    window: Window,
    state: State<'_, AppState>,
    tab_id: String,
) -> AppResult<TabSessionSnapshot> {
    let label = {
        let mut manager = state
            .tabs
            .lock()
            .map_err(|_| AppError::State("tabs unavailable".into()))?;
        if manager.active_tab_id() == tab_id {
            return Err(AppError::Validation("cannot sleep the active tab".into()));
        }
        let tab = manager
            .tab_by_id_mut(&tab_id)
            .ok_or_else(|| AppError::NotFound(format!("tab {tab_id}")))?;
        tab.sleeping = true;
        tab.is_playing = false;
        let label = tab.webview_label.clone();
        manager.save()?;
        label
    };
    if let Ok(mut media) = state.media_by_tab.lock() {
        media.remove(&tab_id);
    }
    if let Ok(mut active_rpc) = state.active_rpc_tab_id.lock() {
        if active_rpc.as_deref() == Some(tab_id.as_str()) {
            *active_rpc = None;
        }
    }
    close_webview_and_clear(&window, &state, &label);
    let snapshot = state
        .tabs
        .lock()
        .map_err(|_| AppError::State("tabs unavailable".into()))?
        .snapshot();
    emit_tabs_snapshot(&window, &snapshot);
    let _ = crate::commands::player::reconcile_rpc(window.app_handle(), &state);
    let latest = state
        .tabs
        .lock()
        .map_err(|_| AppError::State("tabs unavailable".into()))?
        .snapshot();
    Ok(latest)
}

#[tauri::command]
pub fn tab_sidebar_peek(
    window: Window,
    state: State<'_, AppState>,
    peek: bool,
) -> AppResult<()> {
    let is_hover_layout = state
        .settings
        .read()
        .map(|s| {
            let tabs = s.snapshot().tabs;
            tabs.enabled && tabs.layout == crate::settings::model::TabLayout::SidebarHover
        })
        .unwrap_or(false);
    let next_peek = peek && is_hover_layout;
    let previous = state.sidebar_peek.swap(next_peek, Ordering::SeqCst);
    if previous == next_peek {
        return Ok(());
    }
    if next_peek {
        layout_webviews(&window)?;
        let _ = window.app_handle().emit("tabs://sidebar-peek", true);
    } else {
        let _ = window.app_handle().emit("tabs://sidebar-peek", false);
        let win = window.clone();
        let app = window.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(260)).await;
            let still_hidden = app
                .try_state::<AppState>()
                .map(|s| !s.sidebar_peek.load(Ordering::SeqCst))
                .unwrap_or(true);
            if still_hidden {
                let _ = crate::window::layout::layout_webviews(&win);
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn tab_dock_peek(
    window: Window,
    state: State<'_, AppState>,
    peek: bool,
) -> AppResult<()> {
    let is_floating = state
        .settings
        .read()
        .map(|s| {
            let tabs = s.snapshot().tabs;
            tabs.enabled && tabs.layout == crate::settings::model::TabLayout::Floating
        })
        .unwrap_or(false);
    let next_peek = peek && is_floating;
    let previous = state.dock_peek.swap(next_peek, Ordering::SeqCst);
    if previous == next_peek {
        return Ok(());
    }
    let _ = window.app_handle().emit("tabs://dock-peek", next_peek);
    if next_peek {
        layout_webviews(&window)?;
    } else {
        let win = window.clone();
        let app = window.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(260)).await;
            let still_hidden = app
                .try_state::<AppState>()
                .map(|s| !s.dock_peek.load(Ordering::SeqCst))
                .unwrap_or(true);
            if still_hidden {
                let _ = crate::window::layout::layout_webviews(&win);
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn set_sidebar_width(
    window: Window,
    state: State<'_, AppState>,
    width: u32,
    expanded: Option<bool>,
    persist: Option<bool>,
) -> AppResult<()> {
    let clamped = width.clamp(148, 220);
    state.sidebar_width.store(clamped, Ordering::SeqCst);
    if let Some(exp) = expanded {
        state.sidebar_expanded.store(exp, Ordering::SeqCst);
    }
    if persist.unwrap_or(false) {
        if let Ok(mut store) = state.settings.write() {
            let mut next = store.snapshot();
            next.tabs.sidebar_width = clamped;
            if let Some(exp) = expanded {
                next.tabs.sidebar_expanded = exp;
            }
            let _ = store.replace(next.clone());
            let _ = window
                .app_handle()
                .emit(crate::core::events::SETTINGS_CHANGED, &next);
        }
        let _ = layout_webviews(&window);
    } else if !state.launcher_route_active.load(Ordering::SeqCst) {
        let _ = layout_active_youtube_only(&window);
    }
    Ok(())
}

#[tauri::command]
pub fn tab_open_action_menu(window: Window, state: State<'_, AppState>) -> AppResult<()> {
    let enabled = state
        .settings
        .read()
        .map(|s| s.snapshot().tabs.enabled)
        .unwrap_or(true);
    if enabled {
        let _ = window.app_handle().emit("tabs://open-action-menu", true);
    }
    Ok(())
}

#[tauri::command]
pub async fn tabs_clear_isolated_data(state: State<'_, AppState>) -> AppResult<u32> {
    let active_isolated_ids: HashSet<String> = state
        .tabs
        .lock()
        .map(|manager| {
            manager
                .snapshot()
                .tabs
                .into_iter()
                .filter(|t| t.isolated)
                .map(|t| t.id)
                .collect()
        })
        .unwrap_or_default();

    let dir = state.paths.isolated_tabs_dir.clone();
    let removed = tokio::task::spawn_blocking(move || -> u32 {
        let mut count = 0u32;
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if !active_isolated_ids.contains(&name) && std::fs::remove_dir_all(entry.path()).is_ok() {
                    count += 1;
                }
            }
        }
        count
    })
    .await
    .unwrap_or(0);

    Ok(removed)
}
