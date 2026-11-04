use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

/// Theme mode chosen by the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ThemeMode {
    #[default]
    System,
    Light,
    Dark,
}

/// Window backdrop material.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Backdrop {
    #[default]
    Mica,
    Acrylic,
    Solid,
}

/// Persisted theme settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct ThemeSettings {
    pub theme_id: String,
    pub mode: ThemeMode,
    pub backdrop: Backdrop,
    /// Accent color in hexadecimal (`#rrggbb`).
    pub accent: String,
    /// Base radius in pixels.
    pub radius: u16,
    pub motion: bool,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self {
            theme_id: "fluent".to_string(),
            mode: ThemeMode::System,
            backdrop: Backdrop::Mica,
            accent: "#ff0033".to_string(),
            radius: 8,
            motion: true,
        }
    }
}

/// Resolved theme, ready for the UI and the window.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedTheme {
    pub theme_id: String,
    pub name: String,
    pub mode: ThemeMode,
    /// Effective mode after resolving `System`.
    pub effective_mode: ThemeMode,
    pub backdrop: Backdrop,
    pub accent: String,
    pub motion: bool,
    pub tokens: BTreeMap<String, String>,
}

/// Summary of an available theme.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThemeSummary {
    pub id: String,
    pub name: String,
    pub description: String,
}
