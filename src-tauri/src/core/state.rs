use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64};
use std::sync::{Mutex, RwLock};

use tauri::AppHandle;

use crate::core::error::AppResult;
use crate::core::paths::AppPaths;
use crate::extensions::ExtensionService;
use crate::history::HistoryRepository;
use crate::rpc::RpcService;
use crate::settings::SettingsStore;
use crate::tabs::{TabManager, TabMediaState};

/// Shared state between Tauri commands.
pub struct AppState {
    pub paths: AppPaths,
    pub settings: RwLock<SettingsStore>,
    pub extensions: ExtensionService,
    pub rpc: Mutex<RpcService>,
    pub history: HistoryRepository,
    pub tabs: Mutex<TabManager>,
    pub media_by_tab: Mutex<HashMap<String, TabMediaState>>,
    pub painted_webviews: Mutex<HashSet<String>>,
    pub loading_target_label: Mutex<Option<String>>,
    pub dock_width: AtomicU32,
    pub sidebar_width: AtomicU32,
    pub sidebar_expanded: AtomicBool,
    pub auth_modal_dir: Mutex<Option<PathBuf>>,
    pub last_update_check: Mutex<Option<crate::commands::updates::UpdateCheckResult>>,
    pub active_rpc_tab_id: Mutex<Option<String>>,
    /// Whether the active YouTube webview is currently visible.
    pub youtube_visible: AtomicBool,
    /// Whether the opaque startup cover remains until YouTube paints a frame.
    pub youtube_loading: AtomicBool,
    /// Whether YouTube has presented its first startup frame.
    pub youtube_ready: AtomicBool,
    /// Whether the UI webview is elevated to full height to display dropdowns or menus.
    pub ui_elevated: AtomicBool,
    /// Whether the auto-hide tab sidebar is temporarily peeking over YouTube.
    pub sidebar_peek: AtomicBool,
    /// Whether the auto-hide floating bottom dock is temporarily peeking.
    pub dock_peek: AtomicBool,
    /// Whether a launcher page is active above the persistent YouTube webview.
    pub launcher_route_active: AtomicBool,
    /// Expiration time for a microphone request explicitly initiated from the title bar.
    pub microphone_permission_until_ms: AtomicU64,
    /// Monotonic token used to cancel an in-flight native tab slide animation.
    pub tab_transition_gen: AtomicU64,
    /// Whether YouTube currently has a native video in Picture-in-Picture.
    pub native_pip_active: AtomicBool,
}

impl AppState {
    pub fn new(app: &AppHandle) -> AppResult<Self> {
        let paths = AppPaths::resolve(app)?;
        let settings = SettingsStore::load(paths.settings_file.clone())?;
        let initial_sidebar_width = settings.snapshot().tabs.sidebar_width.clamp(148, 220);
        let initial_sidebar_expanded = settings.snapshot().tabs.sidebar_expanded;
        let initial_url = {
            let snap = settings.snapshot();
            if snap.general.open_last_page {
                snap.general.last_youtube_url
            } else {
                None
            }
        };
        let extensions = ExtensionService::new(paths.extensions_dir.clone());
        let rpc = RpcService::new(Some(app.clone()));
        let history =
            tauri::async_runtime::block_on(HistoryRepository::connect(&paths.database_file))?;
        let tabs = TabManager::load(paths.tabs_file.clone(), initial_url)?;
        let initial_target_label = tabs.active_tab().map(|t| t.webview_label.clone());
        let initial_auth_dir = paths.tab_webview_dir("tab-1", false);

        Ok(Self {
            paths,
            settings: RwLock::new(settings),
            extensions,
            rpc: Mutex::new(rpc),
            history,
            tabs: Mutex::new(tabs),
            media_by_tab: Mutex::new(HashMap::new()),
            painted_webviews: Mutex::new(HashSet::new()),
            loading_target_label: Mutex::new(initial_target_label),
            dock_width: AtomicU32::new(260),
            sidebar_width: AtomicU32::new(initial_sidebar_width),
            sidebar_expanded: AtomicBool::new(initial_sidebar_expanded),
            auth_modal_dir: Mutex::new(Some(initial_auth_dir)),
            last_update_check: Mutex::new(None),
            active_rpc_tab_id: Mutex::new(None),
            youtube_visible: AtomicBool::new(true),
            youtube_loading: AtomicBool::new(true),
            youtube_ready: AtomicBool::new(false),
            ui_elevated: AtomicBool::new(false),
            sidebar_peek: AtomicBool::new(false),
            dock_peek: AtomicBool::new(false),
            // Starts false because the initial route is Home; `youtube_loading`
            // keeps the cover elevated until YouTube paints its first frame.
            launcher_route_active: AtomicBool::new(false),
            microphone_permission_until_ms: AtomicU64::new(0),
            tab_transition_gen: AtomicU64::new(0),
            native_pip_active: AtomicBool::new(false),
        })
    }
}
