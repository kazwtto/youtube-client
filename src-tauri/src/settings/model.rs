use std::collections::BTreeSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::core::error::AppResult;
use crate::rpc::model::{RpcSettings, DEFAULT_APP_ID};
use crate::theme::model::ThemeSettings;

/// Settings persisted in `settings.json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub window: WindowSettings,
    pub pip: PipWindowSettings,
    pub theme: ThemeSettings,
    pub rpc: RpcSettings,
    pub history: HistorySettings,
    pub extensions: ExtensionSettings,
    pub general: GeneralSettings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PipMode {
    #[default]
    Custom,
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
            mode: PipMode::Custom,
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
}

/// How the sections are shown in the title bar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TitlebarStyle {
    /// Text tabs with an underline, like YouTube.
    #[default]
    Tabs,
    /// Round icon buttons.
    Icons,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GeneralSettings {
    pub language: String,
    pub hardware_acceleration: bool,
    pub titlebar_style: TitlebarStyle,
    /// Opens the mini player when the window is minimized.
    pub pip_on_minimize: bool,
    /// Opens the mini player when the window loses focus.
    pub pip_on_blur: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            language: "en".to_string(),
            hardware_acceleration: true,
            titlebar_style: TitlebarStyle::Tabs,
            pip_on_minimize: true,
            pip_on_blur: false,
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

        // The Discord application is part of the app, not a user preference:
        // always use the built-in identifier, even if an older settings file
        // stored an empty or different one.
        current.rpc.app_id = DEFAULT_APP_ID.to_string();

        Ok(Self { path, current })
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

    pub fn replace(&mut self, next: AppSettings) -> AppResult<AppSettings> {
        self.current = next;
        self.save()?;
        Ok(self.current.clone())
    }

    fn save(&self) -> AppResult<()> {
        let raw = serde_json::to_string_pretty(&self.current)?;
        let temporary = self.path.with_extension("json.tmp");

        std::fs::write(&temporary, raw)?;
        std::fs::rename(&temporary, &self.path)?;

        Ok(())
    }
}
