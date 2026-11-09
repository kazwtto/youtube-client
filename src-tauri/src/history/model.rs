use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Aggregated history row, ready for the UI.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: String,
    pub title: String,
    pub channel: String,
    pub duration_secs: Option<f64>,
    pub thumbnail_path: Option<String>,
    pub position_secs: Option<f64>,
    pub watched_secs: Option<f64>,
    pub last_watched_at: i64,
    pub watch_count: i64,
}

/// History query parameters.
#[derive(Debug, Clone, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct HistoryQuery {
    pub search: String,
    pub limit: i64,
    pub offset: i64,
}

impl Default for HistoryQuery {
    fn default() -> Self {
        Self {
            search: String::new(),
            limit: 50,
            offset: 0,
        }
    }
}

/// Playback event recorded by the player.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchEventInput {
    pub video_id: String,
    pub title: String,
    #[serde(default)]
    pub channel: String,
    #[serde(default)]
    pub duration_secs: Option<f64>,
    #[serde(default)]
    pub thumbnail_url: Option<String>,
    #[serde(default)]
    pub watched_at: Option<i64>,
    #[serde(default)]
    pub position_secs: Option<f64>,
    #[serde(default)]
    pub watched_secs: Option<f64>,
    #[serde(default)]
    pub session_key: Option<String>,
}
