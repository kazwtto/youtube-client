use std::path::Path;
use std::time::Duration;

use tauri::webview::WebviewBuilder;
use tauri::window::Color;
use tauri::{App, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl, Window, WindowEvent};

use crate::core::error::{AppError, AppResult};
use crate::core::state::AppState;
use crate::settings::model::WindowSettings;
use crate::theme::model::ResolvedTheme;
use crate::theme::service::ThemeService;

pub const MAIN_WINDOW_LABEL: &str = "main";
pub const PIP_WINDOW_LABEL: &str = "pip";
pub const MENU_WINDOW_LABEL: &str = "menu";
pub const UI_WEBVIEW_LABEL: &str = "ui";
pub const YOUTUBE_WEBVIEW_LABEL: &str = "yt";

/// Custom title bar height, in logical pixels. Must match `--titlebar-height`
/// in CSS.
pub const TITLEBAR_HEIGHT: f64 = 40.0;

const INITIAL_WIDTH: f64 = 1280.0;
const INITIAL_HEIGHT: f64 = 800.0;
const YOUTUBE_URL: &str = "https://www.youtube.com";

/// Creates the main window and the two webviews:
/// - `ui`: the launcher interface, covering the entire window (title bar and
///   content).
/// - `yt`: YouTube, in the content area below the title bar, with WebView2
///   browser extensions enabled.
///
/// Each webview owns a separate WebView2 user data folder. WebView2 refuses to
/// share a folder between environments created with different options, and the
/// YouTube webview enables browser extensions while the launcher does not.
pub fn setup(
    app: &mut App,
    webview_data_dir: &Path,
    window_settings: &WindowSettings,
) -> AppResult<Window> {
    let width = window_settings.width.max(960.0);
    let height = window_settings.height.max(600.0);

    let window = tauri::window::WindowBuilder::new(app, MAIN_WINDOW_LABEL)
        .title("YouTube Client")
        .inner_size(width, height)
        .min_inner_size(960.0, 600.0)
        .decorations(false)
        .transparent(true)
        .maximized(window_settings.maximized)
        .build()?;

    let ui = WebviewBuilder::new(UI_WEBVIEW_LABEL, WebviewUrl::App("index.html".into()))
        .data_directory(webview_data_dir.join("ui"))
        .background_color(Color(0, 0, 0, 0));
    window.add_child(
        ui,
        LogicalPosition::new(0.0, 0.0),
        LogicalSize::new(INITIAL_WIDTH, INITIAL_HEIGHT),
    )?;

    let theme = current_theme(&window);
    add_youtube(&window, webview_data_dir, theme.as_ref())?;

    layout_webviews(&window)?;
    observe_window(&window);
    setup_menu_window(app, webview_data_dir)?;

    Ok(window)
}

fn setup_menu_window(app: &mut App, webview_data_dir: &Path) -> AppResult<()> {
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        MENU_WINDOW_LABEL,
        tauri::WebviewUrl::App("menu.html".into()),
    )
    .title("Menu")
    .inner_size(308.0, 274.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .shadow(false)
    .background_color(Color(0, 0, 0, 0))
    .data_directory(webview_data_dir.join("ui"));

    let menu_window = builder.build()?;

    #[cfg(target_os = "windows")]
    {
        use std::ffi::c_void;

        #[link(name = "dwmapi")]
        extern "system" {
            fn DwmSetWindowAttribute(
                hwnd: *mut c_void,
                dwAttribute: u32,
                pvAttribute: *const c_void,
                cbAttribute: u32,
            ) -> i32;
        }

        if let Ok(hwnd) = menu_window.hwnd() {
            unsafe {
                // DWMWA_WINDOW_CORNER_PREFERENCE = 33, DWMWCP_DONOTROUND = 1
                let corner_pref: u32 = 1;
                let _ = DwmSetWindowAttribute(
                    hwnd.0 as *mut c_void,
                    33,
                    &corner_pref as *const _ as *const c_void,
                    std::mem::size_of::<u32>() as u32,
                );

                // DWMWA_BORDER_COLOR = 34, DWMWA_COLOR_NONE = 0xFFFFFFFE
                let border_color: u32 = 0xFFFFFFFE;
                let _ = DwmSetWindowAttribute(
                    hwnd.0 as *mut c_void,
                    34,
                    &border_color as *const _ as *const c_void,
                    std::mem::size_of::<u32>() as u32,
                );
            }
        }
    }

    let handle = menu_window.clone();
    menu_window.on_window_event(move |event| {
        if let WindowEvent::Focused(false) = event {
            let _ = handle.hide();
        }
    });

    Ok(())
}

/// Rebuilds the YouTube webview.
///
/// WebView2 reads the browser extension list only when a webview is created, so
/// enabling or disabling an extension requires recreating the webview. The
/// WebView2 environment is cached per data directory, so the profile (cookies,
/// login, extensions) is preserved. `visible` restores the current visibility,
/// which the caller tracks, because a new webview starts visible.
pub fn reload_youtube(window: &Window, webview_data_dir: &Path, visible: bool) -> AppResult<()> {
    if let Some(existing) = window.get_webview(YOUTUBE_WEBVIEW_LABEL) {
        let _ = existing.close();
    }

    let theme = current_theme(window);
    let mut last_error = None;
    for attempt in 0..10 {
        if attempt > 0 {
            std::thread::sleep(Duration::from_millis(300));
        }

        match add_youtube(window, webview_data_dir, theme.as_ref()) {
            Ok(()) => {
                // A visible webview is shown by the page-load handler once the
                // site is ready; hide it here only when the launcher is active.
                if !visible {
                    if let Some(webview) = window.get_webview(YOUTUBE_WEBVIEW_LABEL) {
                        let _ = webview.hide();
                    }
                }

                return Ok(());
            }
            Err(error) => last_error = Some(error),
        }
    }

    Err(last_error.unwrap_or_else(|| AppError::Other("could not reload YouTube".into())))
}

/// Resolves the theme that is active right now, so the injected script can
/// style the document before YouTube paints for the first time.
fn current_theme(window: &Window) -> Option<ResolvedTheme> {
    use crate::core::state::AppState;

    let state = window.app_handle().try_state::<AppState>()?;
    let settings = state.settings.read().ok()?.snapshot().theme;
    let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
    ThemeService::resolve(&settings, system_dark).ok()
}

fn add_youtube(
    window: &Window,
    webview_data_dir: &Path,
    theme: Option<&ResolvedTheme>,
) -> AppResult<()> {
    let (position, size) = youtube_bounds(window)?;
    let url: tauri::Url = YOUTUBE_URL.parse().expect("invalid YouTube URL");

    // The resolved theme is embedded in the initialization script: the script
    // runs before the page is parsed, so the transparent/themed stylesheet is
    // already in place on the very first paint. Runtime updates still arrive
    // through `apply_to_youtube`.
    let masthead_integrated = window
        .app_handle()
        .try_state::<crate::core::state::AppState>()
        .map(|state| {
            state
                .settings
                .read()
                .map(|store| store.snapshot().general.integrate_masthead)
                .unwrap_or(true)
        })
        .unwrap_or(true);

    let initial = theme
        .and_then(|theme| serde_json::to_string(theme).ok())
        .map(|json| format!("window.__ytdesktopInitialTheme = {json};\n"))
        .unwrap_or_default();
    let initial_masthead =
        format!("window.__ytdesktopInitialMastheadIntegrated = {masthead_integrated};\n");
    let script = format!("{initial}{initial_masthead}{}", include_str!("../../../injected/theme.js"));

    let make = |with_extensions: bool| {
        let mut builder =
            WebviewBuilder::new(YOUTUBE_WEBVIEW_LABEL, WebviewUrl::External(url.clone()))
                .data_directory(webview_data_dir.join("yt"))
                // Transparent so the native Mica/Acrylic backdrop of the window
                // shows through the site. `theme.js` keeps the page opaque when
                // the selected backdrop is Solid. The transparent background is
                // set through `background_color`, exactly like the launcher
                // webview: WebView2 ignores it when `transparent(true)` is also
                // set, and the site ended up painting an opaque surface.
                .background_color(Color(0, 0, 0, 0))
                .initialization_script(script.clone())
                .initialization_script_for_all_frames(include_str!(
                    "../../../injected/observer.js"
                ))
                // YouTube rewrites its head styles during page loads. Re-apply
                // the theme after the document is live so the transparent
                // stylesheet stays the last one and the material shows through.
                //
                // The site also stays hidden until it finished loading, so the
                // launcher can show a loading state instead of a blank or
                // half-painted page.
                .on_page_load(|webview, payload| {
                    let app = webview.app_handle().clone();

                    match payload.event() {
                        tauri::webview::PageLoadEvent::Started => {
                            if payload.url().as_str().contains("accounts.google.com") {
                                let _ = webview.eval("location.href = 'https://www.youtube.com';");
                                return;
                            }
                            set_loading(&app, true);
                            let _ = webview.hide();
                            let _ = app.emit(crate::core::events::YOUTUBE_LOADING, true);
                        }
                        tauri::webview::PageLoadEvent::Finished => {
                            let _ = webview.eval(
                                "window.__ytdesktopReapplyTheme && window.__ytdesktopReapplyTheme();",
                            );

                            if let Some(state) = app.try_state::<crate::core::state::AppState>() {
                                if let Ok(store) = state.settings.read() {
                                    if store.snapshot().general.integrate_masthead {
                                        let hide_script = r#"
                                        (function() {
                                          let style = document.getElementById('ytdesktop-masthead-hide');
                                          if (!style) {
                                            style = document.createElement('style');
                                            style.id = 'ytdesktop-masthead-hide';
                                            style.textContent = `
                                              #masthead-container, ytd-masthead, #ticker.ytd-masthead, #interstitial.ytd-masthead {
                                                display: none !important;
                                                height: 0 !important;
                                                min-height: 0 !important;
                                                max-height: 0 !important;
                                                margin: 0 !important;
                                                padding: 0 !important;
                                                pointer-events: none !important;
                                                visibility: hidden !important;
                                              }
                                              :root, html, body, ytd-app {
                                                --ytd-masthead-height: 0px !important;
                                                --ytd-toolbar-offset: 0px !important;
                                              }
                                              ytd-page-manager#page-manager {
                                                margin-top: 0px !important;
                                                padding-top: 0px !important;
                                              }
                                              #guide.ytd-app, ytd-mini-guide-renderer.ytd-app, #contentContainer.tp-yt-app-drawer {
                                                top: 0px !important;
                                                padding-top: 0px !important;
                                              }
                                            `;
                                            (document.head || document.documentElement).appendChild(style);
                                          }
                                        })()
                                        "#;
                                        let _ = webview.eval(hide_script);
                                    }
                                }
                            }

                            let visible = app
                                .try_state::<crate::core::state::AppState>()
                                .map(|state| {
                                    state.youtube_visible.load(std::sync::atomic::Ordering::SeqCst)
                                })
                                .unwrap_or(true);

                            set_loading(&app, false);

                            if visible {
                                let _ = webview.show();
                            }

                            if let Some(w) = app.get_window(MAIN_WINDOW_LABEL) {
                                let _ = layout_webviews(&w);
                            }

                            let _ = app.emit(crate::core::events::YOUTUBE_LOADING, false);
                        }
                    }
                });

        if with_extensions {
            builder = builder.browser_extensions_enabled(true);
        }

        builder
    };

    if window.add_child(make(true), position, size).is_err() {
        // Some WebView2 runtimes cannot load browser extensions. Fall back to a
        // regular webview so the app still starts; extensions can be revisited
        // after a runtime update.
        window.add_child(make(false), position, size)?;
    }

    // Hidden until the first page finishes loading; the launcher shows its own
    // loading state in the meantime.
    if let Some(webview) = window.get_webview(YOUTUBE_WEBVIEW_LABEL) {
        let _ = webview.hide();
    }

    Ok(())
}

/// Records whether the site is still loading, so the visibility command does
/// not reveal a blank page.
fn set_loading(app: &tauri::AppHandle, loading: bool) {
    if let Some(state) = app.try_state::<crate::core::state::AppState>() {
        state
            .youtube_loading
            .store(loading, std::sync::atomic::Ordering::SeqCst);
    }
}

/// Computes the YouTube webview position and size for the current window.
fn youtube_bounds(window: &Window) -> AppResult<(LogicalPosition<f64>, LogicalSize<f64>)> {
    let size = window.inner_size()?;
    let scale = window.scale_factor()?.max(0.0001);
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;

    Ok((
        LogicalPosition::new(0.0, TITLEBAR_HEIGHT),
        LogicalSize::new(width.max(0.0), (height - TITLEBAR_HEIGHT).max(0.0)),
    ))
}

/// Repositions the webviews according to the current window size and elevation state.
pub fn layout_webviews(window: &Window) -> AppResult<()> {
    let scale = window.scale_factor()?.max(0.0001);
    let size = window.inner_size()?;
    let width = size.width as f64 / scale;
    let height = size.height as f64 / scale;

    if let Some(ui) = window.get_webview(UI_WEBVIEW_LABEL) {
        ui.set_position(LogicalPosition::new(0.0, 0.0))?;
        ui.set_size(LogicalSize::new(width.max(0.0), height.max(0.0)))?;
    }

    if let Some(youtube) = window.get_webview(YOUTUBE_WEBVIEW_LABEL) {
        youtube.set_position(LogicalPosition::new(0.0, TITLEBAR_HEIGHT))?;
        youtube.set_size(LogicalSize::new(
            width.max(0.0),
            (height - TITLEBAR_HEIGHT).max(0.0),
        ))?;
    }

    Ok(())
}

fn observe_window(window: &Window) {
    let handle = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. } => {
            let _ = layout_webviews(&handle);
            remember_window_size(&handle);

            // Restoring the window brings the page back; the mini player is no
            // longer needed. Focus alone is unreliable here because the mini
            // player is always on top.
            if !handle.is_minimized().unwrap_or(true) {
                close_pip(&handle.app_handle());
            }
        }
        WindowEvent::CloseRequested { .. } => {
            persist_window_state(&handle);
            // The mini player is part of this window: closing the app closes it
            // too, instead of leaving a floating picture behind.
            if let Some(pip) = handle.app_handle().get_webview_window(PIP_WINDOW_LABEL) {
                let _ = pip.close();
            }
        }
        WindowEvent::ThemeChanged(_) => {
            reapply_theme(&handle);
        }
        WindowEvent::Focused(false) => request_pip_if_configured(&handle),
        WindowEvent::Focused(true) => close_pip(&handle.app_handle()),
        _ => {}
    });
}

/// Follows the mini player move/resize and writes its geometry when it closes.
fn remember_pip_geometry(app: &tauri::AppHandle, pip: &tauri::WebviewWindow) {
    let handle = app.clone();
    pip.on_window_event(move |event| {
        if crate::commands::window::PIP_DRAGGING.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let Some(state) = handle.try_state::<AppState>() else {
            return;
        };

        let Ok(mut store) = state.settings.write() else {
            return;
        };

        let mut remember = false;

        match event {
            WindowEvent::Moved(position) => {
                if let Ok(scale) = pip_scale(&handle) {
                    let (width, height) = (store.snapshot().pip.width, store.snapshot().pip.height);
                    store.set_pip_geometry(
                        Some(position.x as f64 / scale),
                        Some(position.y as f64 / scale),
                        width,
                        height,
                    );
                    remember = true;
                }
            }
            WindowEvent::Resized(size) => {
                if let Ok(scale) = pip_scale(&handle) {
                    let width = size.width as f64 / scale;
                    let height = size.height as f64 / scale;

                    store.set_pip_geometry(None, None, width, height);
                    remember = true;
                }
            }
            WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => {
                let next = store.snapshot();
                let _ = store.replace(next);
            }
            _ => {}
        }

        drop(store);

        if remember {
            schedule_pip_save(&handle);
        }
    });
}

fn pip_scale(app: &tauri::AppHandle) -> Result<f64, ()> {
    app.get_webview_window(PIP_WINDOW_LABEL)
        .and_then(|window| window.scale_factor().ok())
        .map(|scale| scale.max(0.0001))
        .ok_or(())
}

/// Closes the mini player when the main window is back in front and resumes the
/// video it paused, so playback never stops on the way back to the app.
pub fn close_pip(app: &tauri::AppHandle) {
    let Some(pip) = app.get_webview_window(PIP_WINDOW_LABEL) else {
        return;
    };

    let _ = pip.close();

    if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
        if let Some(youtube) = window.get_webview(YOUTUBE_WEBVIEW_LABEL) {
            let _ = youtube.eval(
                "(function(){const v=document.querySelector('video');if(v&&v.paused){v.play().catch(()=>{});}return true;})()",
            );
        }
    }
}

/// Creates (or reveals) the mini player for the video that is playing.
///
/// Window creation needs the event loop, so callers on the UI thread should
/// spawn this off the callback.
pub fn open_pip(app: &tauri::AppHandle) -> AppResult<()> {
    let settings = app
        .try_state::<AppState>()
        .and_then(|state| state.settings.read().ok().map(|store| store.snapshot()))
        .unwrap_or_default();

    if !settings.pip.enabled {
        return Ok(());
    }

    if settings.pip.mode == crate::settings::model::PipMode::Native {
        if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
            if let Some(youtube) = window.get_webview(YOUTUBE_WEBVIEW_LABEL) {
                let _ = youtube.eval(
                    r#"(async function() {
                        const v = document.querySelector('video');
                        if (!v) return;
                        try {
                            if (document.pictureInPictureElement) {
                                await document.exitPictureInPicture();
                            } else {
                                await v.requestPictureInPicture();
                            }
                        } catch (e) {
                            console.error('Native PiP error:', e);
                        }
                    })()"#,
                );
            }
        }
        return Ok(());
    }

    if let Some(existing) = app.get_webview_window(PIP_WINDOW_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    crate::commands::window::reset_pip_time();

    let video_id = {
        let state = app
            .try_state::<AppState>()
            .ok_or_else(|| AppError::State("app not ready".into()))?;

        let snapshot = state
            .last_player
            .lock()
            .map_err(|_| AppError::State("player unavailable".into()))?;

        let current = snapshot
            .as_ref()
            .ok_or_else(|| AppError::Validation("no video is playing".into()))?;

        // A paused video is not playing anywhere: the mini player is for what
        // is running, so nothing opens.
        if !current.is_playing {
            return Ok(());
        }

        current
            .video_id
            .clone()
            .ok_or_else(|| AppError::Validation("no video is playing".into()))?
    };

    if !video_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-' || character == '_')
    {
        return Err(AppError::Validation("invalid video id".into()));
    }

    let geometry = app
        .try_state::<AppState>()
        .map(|state| {
            state
                .settings
                .read()
                .map(|store| store.snapshot().pip)
                .unwrap_or_default()
        })
        .unwrap_or_default();

    // The mini player shows a 16:9 video, so the window uses that same ratio:
    // any other shape letterboxes the picture.
    let width = geometry.width.max(320.0);
    let height = (width * 9.0 / 16.0).max(180.0);

    // `pip-player.js` is injected into every frame of this page, so it reaches
    // the player's own document, removes the logo the site draws over the video
    // and puts the window buttons in its place.
    let mut builder = tauri::WebviewWindowBuilder::new(
        app,
        PIP_WINDOW_LABEL,
        tauri::WebviewUrl::App("pip.html".into()),
    )
    .title(format!("Mini player � {video_id}"))
    .inner_size(width, height)
    .min_inner_size(320.0, 180.0)
    .decorations(false)
    .resizable(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .focused(true)
    .background_color(Color(0, 0, 0, 255))
    .initialization_script_for_all_frames(include_str!("../../../injected/pip-player.js"));

    if let Some((x, y)) = restored_pip_position(app, &geometry) {
        builder = builder.position(x, y);
    }

    let pip = builder.build()?;

    // The builder resolves the size before the window has a scale factor, which
    // produces the wrong size on scaled displays. Applying it again now, with
    // the real scale factor, keeps the video area at the remembered size.
    let _ = pip.set_size(tauri::LogicalSize::new(width, height));

    // Any other shape stretches the picture while the user drags an edge, so
    // the window follows the 16:9 ratio of the video.
    lock_pip_aspect(&pip);

    remember_pip_geometry(app, &pip);

    // The mini player takes over playback so the same audio never plays twice.
    if let Some(window) = app.get_window(MAIN_WINDOW_LABEL) {
        if let Some(youtube) = window.get_webview(YOUTUBE_WEBVIEW_LABEL) {
            let _ = youtube.eval(
                "(function(){const v=document.querySelector('video');if(v&&!v.paused){v.pause();}return true;})()",
            );
        }
    }

    Ok(())
}

pub const AUTH_WINDOW_LABEL: &str = "auth";

pub fn open_auth_window(app: &tauri::AppHandle) -> AppResult<()> {
    if let Some(existing) = app.get_webview_window(AUTH_WINDOW_LABEL) {
        let _ = existing.show();
        let _ = existing.set_focus();
        return Ok(());
    }

    let url: tauri::Url = "https://accounts.google.com/ServiceLogin?service=youtube&continue=https%3A%2F%2Fwww.youtube.com"
        .parse()
        .map_err(|e| AppError::Validation(format!("{e}")))?;

    let state = app
        .try_state::<AppState>()
        .ok_or_else(|| AppError::State("app not ready".into()))?;
    let webview_data_dir = state.paths.webview_data_dir.join("yt");

    let builder = tauri::WebviewWindowBuilder::new(
        app,
        AUTH_WINDOW_LABEL,
        tauri::WebviewUrl::External(url),
    )
    .title("Fazer login no Google")
    .inner_size(500.0, 680.0)
    .min_inner_size(400.0, 500.0)
    .center()
    .resizable(true)
    .decorations(true)
    .data_directory(webview_data_dir)
    .on_page_load(move |webview, payload| {
        if let tauri::webview::PageLoadEvent::Finished = payload.event() {
            let url_str = payload.url().as_str();
            if url_str.starts_with("https://www.youtube.com") && !url_str.contains("ServiceLogin") {
                let app = webview.app_handle().clone();
                let _ = webview.close();
                if let Some(main) = app.get_window(MAIN_WINDOW_LABEL) {
                    if let Some(yt) = main.get_webview(YOUTUBE_WEBVIEW_LABEL) {
                        let _ = yt.eval("location.href = 'https://www.youtube.com';");
                    }
                }
            }
        }
    });

    builder.build()?;
    Ok(())
}

use std::sync::atomic::{AtomicU64, Ordering};

static PIP_ASPECT_RATIO: AtomicU64 = AtomicU64::new(0);

pub fn set_pip_aspect_ratio(app: &tauri::AppHandle, ratio: f64) -> AppResult<()> {
    if !(0.4..=3.5).contains(&ratio) {
        return Err(AppError::Validation(format!("invalid ratio: {ratio}")));
    }

    PIP_ASPECT_RATIO.store(ratio.to_bits(), Ordering::SeqCst);

    if let Some(pip) = app.get_webview_window(PIP_WINDOW_LABEL) {
        let scale = pip.scale_factor().unwrap_or(1.0).max(0.0001);
        if let Ok(size) = pip.inner_size() {
            let width = (size.width as f64 / scale).clamp(240.0, 960.0);
            let height = (width / ratio).clamp(135.0, 720.0);
            let _ = pip.set_size(tauri::LogicalSize::new(width, height));
        }
    }

    Ok(())
}

pub fn current_pip_aspect_ratio() -> f64 {
    let bits = PIP_ASPECT_RATIO.load(Ordering::SeqCst);
    if bits == 0 {
        16.0 / 9.0
    } else {
        f64::from_bits(bits)
    }
}

/// Keeps the mini player at the ratio of the video while it is resized.
///
/// The axis the user is dragging wins, and the other one follows, so the window
/// never fights the pointer.
fn lock_pip_aspect(pip: &tauri::WebviewWindow) {
    use std::sync::{Arc, Mutex};

    let handle = pip.clone();
    let last = Arc::new(Mutex::new((0.0f64, 0.0f64)));

    let scale = pip.scale_factor().unwrap_or(1.0).max(0.0001);
    if let Ok(size) = pip.inner_size() {
        if let Ok(mut guard) = last.lock() {
            *guard = (size.width as f64 / scale, size.height as f64 / scale);
        }
    }

    pip.on_window_event(move |event| {
        let tauri::WindowEvent::Resized(size) = event else {
            return;
        };

        let scale = handle.scale_factor().unwrap_or(1.0).max(0.0001);
        let width = size.width as f64 / scale;
        let height = size.height as f64 / scale;

        let Ok(mut last) = last.lock() else {
            return;
        };

        let (last_width, last_height) = *last;
        if (width - last_width).abs() < 1.0 && (height - last_height).abs() < 1.0 {
            return;
        }

        let ratio = current_pip_aspect_ratio();
        let (target_width, target_height) = if (width - last_width).abs()
            >= (height - last_height).abs()
        {
            (width, width / ratio)
        } else {
            (height * ratio, height)
        };

        *last = (target_width, target_height);
        let _ = handle.set_size(tauri::LogicalSize::new(target_width, target_height));
    });
}

/// Returns the remembered mini player position, moved back inside the monitor
/// that overlaps it the most.
///
/// A saved position can land outside the desktop once a monitor is unplugged or
/// the resolution changes, and a borderless window left half off the screen is
/// nearly impossible to grab back.
fn restored_pip_position(
    app: &tauri::AppHandle,
    geometry: &crate::settings::model::PipWindowSettings,
) -> Option<(f64, f64)> {
    let (x, y) = (geometry.x?, geometry.y?);
    let (width, height) = (geometry.width.max(320.0), geometry.height.max(180.0));

    let monitors = app.available_monitors().unwrap_or_default();
    if monitors.is_empty() {
        return Some((x, y));
    }

    let mut best: Option<((f64, f64, f64, f64), f64)> = None;

    for monitor in &monitors {
        let scale = monitor.scale_factor().max(0.0001);
        let position = monitor.position();
        let size = monitor.size();

        let left = position.x as f64 / scale;
        let top = position.y as f64 / scale;
        let right = left + size.width as f64 / scale;
        let bottom = top + size.height as f64 / scale;

        let overlap_width = (x + width).min(right) - x.max(left);
        let overlap_height = (y + height).min(bottom) - y.max(top);
        let overlap = overlap_width.max(0.0) * overlap_height.max(0.0);

        if best.map(|(_, current)| overlap > current).unwrap_or(true) {
            best = Some(((left, top, right, bottom), overlap));
        }
    }

    let (left, top, right, bottom) = best?.0;

    // A window larger than the screen stays anchored to its top-left corner.
    Some((
        x.clamp(left, (right - width).max(left)),
        y.clamp(top, (bottom - height).max(top)),
    ))
}

/// Writes the mini player geometry after the drag settles, so resizing or
/// moving the window does not rewrite the settings file on every event.
fn schedule_pip_save(app: &tauri::AppHandle) {
    use std::sync::atomic::{AtomicU64, Ordering};

    static GENERATION: AtomicU64 = AtomicU64::new(0);

    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let handle = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(420));

        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }

        let Some(state) = handle.try_state::<AppState>() else {
            return;
        };

        let Ok(mut store) = state.settings.write() else {
            return;
        };

        let next = store.snapshot();
        let _ = store.replace(next);
    });
}

/// Opens the mini player when the window is minimized or loses focus, if the
/// user enabled it. The decision runs off the event callback so creating a
/// window never blocks the event loop.
fn request_pip_if_configured(window: &Window) {
    use crate::core::state::AppState;

    let Some(state) = window.app_handle().try_state::<AppState>() else {
        return;
    };

    let settings = match state.settings.read() {
        Ok(store) => store.snapshot(),
        Err(_) => return,
    };

    if !settings.pip.enabled {
        return;
    }

    let general = settings.general;
    if !general.pip_on_blur && !general.pip_on_minimize {
        return;
    }

    let handle = window.clone();
    std::thread::spawn(move || {
        // Focus moves before the window state settles; wait a moment so a
        // minimize is recognized as such.
        std::thread::sleep(Duration::from_millis(260));

        if matches!(handle.app_handle().get_webview_window("pip"), Some(pip) if pip.is_focused().unwrap_or(false))
        {
            return;
        }

        let minimized = handle.is_minimized().unwrap_or(false);
        let allowed = if minimized {
            general.pip_on_minimize
        } else {
            general.pip_on_blur
        };

        if !allowed {
            return;
        }

        // The webview may be suspended while the window is minimized, so the
        // mini player is created here instead of asking the UI to do it.
        if let Err(error) = open_pip(&handle.app_handle()) {
            eprintln!("pip: {error}");
        }
    });
}

fn logical_window_size(window: &Window) -> Option<(f64, f64)> {
    let size = window.inner_size().ok()?;
    let scale = window.scale_factor().ok()?.max(0.0001);
    Some((size.width as f64 / scale, size.height as f64 / scale))
}

/// Updates the in-memory restore size while the user drags the window. It is
/// intentionally not written to disk until the window closes.
fn remember_window_size(window: &Window) {
    if window.is_maximized().unwrap_or(false) {
        return;
    }

    let Some((width, height)) = logical_window_size(window) else {
        return;
    };

    if width < 960.0 || height < 600.0 {
        return;
    }

    use crate::core::state::AppState;
    if let Some(state) = window.app_handle().try_state::<AppState>() {
        if let Ok(mut store) = state.settings.write() {
            store.set_window_size(width, height);
        }
    }
}

fn persist_window_state(window: &Window) {
    let maximized = window.is_maximized().unwrap_or(false);
    let size = if maximized {
        None
    } else {
        logical_window_size(window)
    };

    use crate::core::state::AppState;
    let Some(state) = window.app_handle().try_state::<AppState>() else {
        return;
    };

    let Ok(mut store) = state.settings.write() else {
        return;
    };

    let mut next = store.snapshot();
    next.window.maximized = maximized;

    if let Some((width, height)) = size {
        if width >= 960.0 && height >= 600.0 {
            next.window.width = width;
            next.window.height = height;
        }
    }

    let _ = store.replace(next);
}

/// Re-applies the theme after the operating system theme changes, but only
/// while the user follows the system mode.
fn reapply_theme(window: &Window) {
    use crate::core::state::AppState;
    use crate::theme::model::ThemeMode;
    use crate::theme::service::ThemeService;

    let app = window.app_handle();
    let Some(state) = app.try_state::<AppState>() else {
        return;
    };

    let theme = match state.settings.read() {
        Ok(settings) => settings.snapshot().theme,
        Err(_) => return,
    };

    if theme.mode != ThemeMode::System {
        return;
    }

    let system_dark = matches!(window.theme(), Ok(tauri::Theme::Dark));
    if let Ok(resolved) = ThemeService::resolve(&theme, system_dark) {
        let _ = ThemeService::apply_to_window(window, &resolved);
        let _ = ThemeService::apply_to_youtube(window, &resolved);
        let _ = app.emit(crate::core::events::THEME_CHANGED, &resolved);
    }
}
