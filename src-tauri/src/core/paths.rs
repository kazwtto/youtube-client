use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::core::error::AppResult;

/// Directories and files used by the application.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub settings_file: PathBuf,
    pub tabs_file: PathBuf,
    pub data_dir: PathBuf,
    pub extensions_dir: PathBuf,
    pub thumbnails_dir: PathBuf,
    pub database_file: PathBuf,
    /// Root folder for the per-webview WebView2 user data directories.
    pub webview_data_dir: PathBuf,
    /// Shared/default YouTube WebView2 data directories.
    pub profiles_dir: PathBuf,
    /// Per-tab isolated YouTube WebView2 data directories.
    pub isolated_tabs_dir: PathBuf,
}

impl AppPaths {
    /// Resolves and creates the app directories.
    pub fn resolve(app: &AppHandle) -> AppResult<Self> {
        let config_dir = app.path().app_config_dir()?;
        let data_dir = app.path().app_data_dir()?;
        let extensions_dir = data_dir.join("extensions");
        let thumbnails_dir = data_dir.join("thumbnails");
        let webview_data_dir = data_dir.join("webview");
        let profiles_dir = webview_data_dir.join("profiles");
        let isolated_tabs_dir = webview_data_dir.join("tabs");

        std::fs::create_dir_all(&config_dir)?;
        std::fs::create_dir_all(&data_dir)?;
        std::fs::create_dir_all(&extensions_dir)?;
        std::fs::create_dir_all(&thumbnails_dir)?;
        std::fs::create_dir_all(&webview_data_dir)?;
        std::fs::create_dir_all(&profiles_dir)?;
        std::fs::create_dir_all(&isolated_tabs_dir)?;

        let legacy_yt_dir = webview_data_dir.join("yt");
        let default_profile_dir = profiles_dir.join("default");
        if legacy_yt_dir.exists() && !default_profile_dir.exists() {
            let _ = std::fs::rename(&legacy_yt_dir, &default_profile_dir);
        }

        Ok(Self {
            settings_file: config_dir.join("settings.json"),
            tabs_file: config_dir.join("tabs.json"),
            database_file: data_dir.join("history.db"),
            data_dir,
            extensions_dir,
            thumbnails_dir,
            webview_data_dir,
            profiles_dir,
            isolated_tabs_dir,
        })
    }

    pub fn tab_webview_dir(&self, tab_id: &str, isolated: bool) -> PathBuf {
        if isolated {
            self.isolated_tabs_dir.join(tab_id)
        } else {
            self.profiles_dir.join("default")
        }
    }
}
