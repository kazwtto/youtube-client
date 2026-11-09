use std::collections::BTreeSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::core::error::AppResult;
use crate::rpc::model::{RpcSettings, DEFAULT_APP_ID, DEFAULT_MUSIC_APP_ID};
use crate::theme::model::ThemeSettings;

/// Settings persisted in `settings.json`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default = "legacy_settings_version")]
    pub settings_version: u16,
    pub window: WindowSettings,
    pub pip: PipWindowSettings,
    pub theme: ThemeSettings,
    pub rpc: RpcSettings,
    pub history: HistorySettings,
    pub extensions: ExtensionSettings,
    pub general: GeneralSettings,
}

const CURRENT_SETTINGS_VERSION: u16 = 1;

fn legacy_settings_version() -> u16 {
    0
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            settings_version: CURRENT_SETTINGS_VERSION,
            window: WindowSettings::default(),
            pip: PipWindowSettings::default(),
            theme: ThemeSettings::default(),
            rpc: RpcSettings::default(),
            history: HistorySettings::default(),
            extensions: ExtensionSettings::default(),
            general: GeneralSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PipMode {
    Custom,
    #[default]
    Native,
}

/// Mini player geometry, remembered between sessions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct PipWindowSettings {
    pub enabled: bool,
    pub mode: PipMode,
    pub width: f64,
    pub height: f64,
    pub x: Option<f64>,
    pub y: Option<f64>,
}

impl Default for PipWindowSettings {
    fn default() -> Self {
        Self {
            enabled: true,
            mode: PipMode::Native,
            width: 480.0,
            height: 270.0,
            x: None,
            y: None,
        }
    }
}

/// Last window geometry. The size is kept in logical pixels and is only
/// updated while the window is not maximized, so maximizing does not destroy
/// the restore size.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct WindowSettings {
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
}

impl Default for WindowSettings {
    fn default() -> Self {
        Self {
            width: 1280.0,
            height: 800.0,
            maximized: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HistorySettings {
    pub enabled: bool,
    /// Minimum playback time before recording to history.
    pub minimum_watch_secs: u32,
    pub keep_thumbnails: bool,
}

impl Default for HistorySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            minimum_watch_secs: 5,
            keep_thumbnails: true,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ExtensionSettings {
    /// Extensions disabled by the user. Extensions are enabled by default.
    pub disabled: BTreeSet<String>,
    /// Remembered custom folder chosen by the user for automatic scanning.
    pub custom_folder: Option<PathBuf>,
}

/// How the sections are shown in the title bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TitlebarStyle {
    /// Text tabs with an underline, like YouTube.
    Tabs,
    /// Round icon buttons.
    #[default]
    Icons,
    /// A single menu button that lists all sections.
    Compact,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GeneralSettings {
    pub language: String,
    pub hardware_acceleration: bool,
    pub titlebar_style: TitlebarStyle,
    /// Hides the main window in the notification area when minimized.
    pub minimize_to_tray: bool,
    /// Opens the mini player when the window is minimized.
    pub pip_on_minimize: bool,
    /// Opens the mini player when the window loses focus.
    pub pip_on_blur: bool,
    /// Hides YouTube's masthead and integrates guide, search, and auth into the titlebar.
    pub integrate_masthead: bool,
    /// Reopens the most recent YouTube page on the next launch.
    pub open_last_page: bool,
    /// Last safe YouTube URL, stored independently from visible settings.
    pub last_youtube_url: Option<String>,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            language: "en".to_string(),
            hardware_acceleration: true,
            titlebar_style: TitlebarStyle::Icons,
            minimize_to_tray: false,
            pip_on_minimize: true,
            pip_on_blur: false,
            integrate_masthead: false,
            open_last_page: true,
            last_youtube_url: None,
        }
    }
}

/// Settings store with atomic writes.
pub struct SettingsStore {
    path: PathBuf,
    current: AppSettings,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> AppResult<Self> {
        let mut current = if path.exists() {
            match std::fs::read_to_string(&path) {
                Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
                Err(_) => AppSettings::default(),
            }
        } else {
            AppSettings::default()
        };

        let migrated = current.settings_version < CURRENT_SETTINGS_VERSION;
        if migrated {
            // Custom was the former default; new installs and legacy profiles
            // now start with the built-in native player.
            if current.pip.mode == PipMode::Custom {
                current.pip.mode = PipMode::Native;
            }
            current.settings_version = CURRENT_SETTINGS_VERSION;
        }

        // These applications and their assets are part of the integration, not
        // user preferences. Ignore identifiers left by older settings files.
        current.rpc.app_id = DEFAULT_APP_ID.to_string();
        current.rpc.music_app_id = DEFAULT_MUSIC_APP_ID.to_string();

        let store = Self { path, current };
        if migrated {
            store.save()?;
        }
        Ok(store)
    }

    pub fn snapshot(&self) -> AppSettings {
        self.current.clone()
    }

    /// Remembers the current restore size in memory. It is written to disk
    /// when the window closes, avoiding a settings write on every resize event.
    pub fn set_window_size(&mut self, width: f64, height: f64) {
        self.current.window.width = width;
        self.current.window.height = height;
    }

    /// Remembers the mini player geometry in memory; it is written to disk
    /// when the mini player closes, so dragging does not touch the file.
    pub fn set_pip_geometry(&mut self, x: Option<f64>, y: Option<f64>, width: f64, height: f64) {
        if let Some(x) = x {
            self.current.pip.x = Some(x);
        }
        if let Some(y) = y {
            self.current.pip.y = Some(y);
        }
        self.current.pip.width = width.max(320.0);
        self.current.pip.height = height.max(180.0);
    }

    pub fn replace(&mut self, mut next: AppSettings) -> AppResult<AppSettings> {
        next.settings_version = CURRENT_SETTINGS_VERSION;
        next.rpc.app_id = DEFAULT_APP_ID.to_string();
        next.rpc.music_app_id = DEFAULT_MUSIC_APP_ID.to_string();
        self.current = next;
        self.save()?;
        Ok(self.current.clone())
    }

    pub fn remember_youtube_url(&mut self, url: String) -> AppResult<()> {
        if self.current.general.last_youtube_url.as_deref() == Some(&url) {
            return Ok(());
        }
        self.current.general.last_youtube_url = Some(url);
        self.save()
    }

    fn save(&self) -> AppResult<()> {
        let raw = serde_json::to_string_pretty(&self.current)?;
        let temporary = self.path.with_extension("json.tmp");

        std::fs::write(&temporary, raw)?;
        std::fs::rename(&temporary, &self.path)?;

        Ok(())
    }
}
