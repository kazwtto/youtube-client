use std::sync::atomic::AtomicBool;
use std::sync::{Mutex, RwLock};

use tauri::AppHandle;

use crate::core::error::AppResult;
use crate::core::paths::AppPaths;
use crate::extensions::ExtensionService;
use crate::history::HistoryRepository;
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
}

impl AppState {
    pub fn new(app: &AppHandle) -> AppResult<Self> {
        let paths = AppPaths::resolve(app)?;
        let settings = SettingsStore::load(paths.settings_file.clone())?;
        let extensions = ExtensionService::new(paths.extensions_dir.clone());
        let rpc = RpcService::new();
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
        })
    }
}
