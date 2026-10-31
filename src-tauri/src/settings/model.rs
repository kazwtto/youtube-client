use std::collections::BTreeSet;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::core::error::AppResult;
use crate::rpc::model::RpcSettings;
use crate::theme::model::ThemeSettings;

/// Settings persisted in `settings.json`.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: ThemeSettings,
    pub rpc: RpcSettings,
    pub history: HistorySettings,
    pub extensions: ExtensionSettings,
    pub general: GeneralSettings,
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GeneralSettings {
    pub language: String,
    pub hardware_acceleration: bool,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            language: "en".to_string(),
            hardware_acceleration: true,
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
        let current = if path.exists() {
            match std::fs::read_to_string(&path) {
                Ok(raw) => serde_json::from_str(&raw).unwrap_or_default(),
                Err(_) => AppSettings::default(),
            }
        } else {
            AppSettings::default()
        };

        Ok(Self { path, current })
    }

    pub fn snapshot(&self) -> AppSettings {
        self.current.clone()
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
