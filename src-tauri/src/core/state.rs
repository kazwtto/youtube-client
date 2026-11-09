use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Mutex, RwLock};

use tauri::AppHandle;

use crate::core::error::AppResult;
use crate::core::paths::AppPaths;
use crate::extensions::ExtensionService;
use crate::history::HistoryRepository;
use crate::player::PlayerSnapshot;
use crate::player::WatchTracker;
use crate::rpc::RpcService;
use crate::settings::SettingsStore;

/// Shared state between Tauri commands.
pub struct AppState {
    pub paths: AppPaths,
    pub settings: RwLock<SettingsStore>,
    pub extensions: ExtensionService,
    pub rpc: Mutex<RpcService>,
    pub history: HistoryRepository,
    pub watch: Mutex<WatchTracker>,
    /// Whether the YouTube webview is currently visible. Tracked so a webview
    /// rebuilt after an extension change keeps the right visibility.
    pub youtube_visible: AtomicBool,
    /// Whether the opaque startup cover remains until YouTube paints a frame.
    pub youtube_loading: AtomicBool,
    /// Whether YouTube has presented its first startup frame.
    pub youtube_ready: AtomicBool,
    /// Whether the UI webview is elevated to full height to display dropdowns or menus.
    pub ui_elevated: AtomicBool,
    /// Whether a launcher page is active above the persistent YouTube webview.
    pub launcher_route_active: AtomicBool,
    /// Expiration time for a microphone request explicitly initiated from the title bar.
    pub microphone_permission_until_ms: AtomicU64,
    /// Whether YouTube currently has a native video in Picture-in-Picture.
    pub native_pip_active: AtomicBool,
    /// Last state reported by the YouTube player, used by picture-in-picture.
    pub last_player: Mutex<Option<PlayerSnapshot>>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> AppResult<Self> {
        let paths = AppPaths::resolve(app)?;
        let settings = SettingsStore::load(paths.settings_file.clone())?;
        let extensions = ExtensionService::new(paths.extensions_dir.clone());
        let rpc = RpcService::new(Some(app.clone()));
        let history =
            tauri::async_runtime::block_on(HistoryRepository::connect(&paths.database_file))?;

        Ok(Self {
            paths,
            settings: RwLock::new(settings),
            extensions,
            rpc: Mutex::new(rpc),
            history,
            watch: Mutex::new(WatchTracker::default()),
            youtube_visible: AtomicBool::new(true),
            youtube_loading: AtomicBool::new(true),
            youtube_ready: AtomicBool::new(false),
            ui_elevated: AtomicBool::new(false),
            // Keep the opaque launcher/loading surface above YouTube until the
            // visible YouTube webview confirms its first rendered frame.
            launcher_route_active: AtomicBool::new(true),
            microphone_permission_until_ms: AtomicU64::new(0),
            native_pip_active: AtomicBool::new(false),
            last_player: Mutex::new(None),
        })
    }
}
